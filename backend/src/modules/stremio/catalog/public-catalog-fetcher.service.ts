import {
  WatchlistFilm,
  ListEntry,
  getWatchlist as rawGetWatchlist,
  getListEntries as rawGetListEntries,
  getFilms as rawGetFilms,
  searchFilms as rawSearchFilms,
  searchMemberByUsername as rawSearchMemberByUsername,
  getContributorContributions as rawGetContributorContributions,
} from '../../letterboxd/letterboxd.client.js';
import {
  transformWatchlistToMetas,
  transformListEntriesToMetas,
  transformSearchResultsToMetas,
  applyAdultPosterFixes,
  cacheFilmMapping,
  enrichMetasWithCinemeta,
} from '../catalog.service.js';
import type { StremioMeta } from '../catalog.service.js';
import type { PublicConfig } from '../../../lib/config-encoding.js';
import { SORT_VARIANT_KEYS } from '../stremio.service.js';
import { trackEvent } from '../../../lib/metrics.js';
import { callWithAppToken } from '../../../lib/app-client.js';
import type { LRUCache } from 'lru-cache';
import {
  popularCatalogCache,
  top250CatalogCache,
  publicWatchlistCache,
  publicListCache,
  publicContributorCache,
  likedFilmsCache,
  memberIdCache,
  listNameCache,
  isStale,
  POPULAR_FRESH_MS,
  TOP250_FRESH_MS,
  PUBLIC_WATCHLIST_FRESH_MS,
  PUBLIC_LIST_FRESH_MS,
  PUBLIC_CONTRIBUTOR_FRESH_MS,
  LIKED_FILMS_FRESH_MS,
} from '../../../lib/cache.js';
import { loadCatalogPage, refreshCatalog, type CatalogSource } from './catalog-loader.js';
import { createChildLogger } from '../../../lib/logger.js';
import {
  cacheKeyPopular,
  cacheKeyTop250,
  cacheKeyPublicWatchlist,
  cacheKeyPublicList,
  cacheKeyPublicLiked,
  cacheKeyPublicContributor,
  getFullPublicCatalogFromCache,
} from './catalog-cache-keys.js';
import { parseCombinedFilter, shuffleArray, filterUnreleasedFilms, sliceReleased, parseExtra } from './catalog-filter.js';
import { filterFilmsByReleaseData } from './release-filter.js';

const logger = createChildLogger('public-catalog-fetcher');

// Stremio expects pages of this size
export const CATALOG_PAGE_SIZE = 100;

// Top 250 Narrative Feature Films list by Dave (LID)
const TOP_250_LIST_ID = '8HjM';

// ─── Member ID resolution ─────────────────────────────────────────────────────

export async function resolveMemberId(username: string): Promise<string | null> {
  const cacheKey = `member:${username.toLowerCase()}`;
  const cached = memberIdCache.get(cacheKey);
  if (cached) return cached;

  const member = await callWithAppToken((token) => rawSearchMemberByUsername(token, username));
  if (!member) return null;

  memberIdCache.set(cacheKey, member.id);
  return member.id;
}

// ─── Shared loading ───────────────────────────────────────────────────────────

/**
 * One page of a public catalog: from cache when there (refreshing it in the
 * background once older than `freshMs`), otherwise from a progressive load.
 */
async function servePublicCatalog<T>(
  cache: LRUCache<string, { metas: StremioMeta[] }>,
  freshMs: number,
  source: CatalogSource<T>,
  skip: number,
): Promise<{ metas: StremioMeta[] }> {
  const cached = cache.get(source.key);
  if (cached) {
    if (isStale(cache, source.key, freshMs)) refreshCatalog(source);
    return { metas: cached.metas.slice(skip, skip + CATALOG_PAGE_SIZE) };
  }
  return { metas: await loadCatalogPage(source, skip, CATALOG_PAGE_SIZE) };
}

async function filmsToMetas(films: WatchlistFilm[], showRatings: boolean, fixAdultPosters: boolean): Promise<StremioMeta[]> {
  const metas = await transformWatchlistToMetas(films, showRatings);
  if (fixAdultPosters) await applyAdultPosterFixes(films, metas, showRatings);
  for (const film of films) cacheFilmMapping(film);
  return metas;
}

async function listEntriesToMetas(entries: ListEntry[], showRatings: boolean, fixAdultPosters: boolean): Promise<StremioMeta[]> {
  const metas = await transformListEntriesToMetas(entries, showRatings);
  if (fixAdultPosters) await applyAdultPosterFixes(entries.map((e) => e.film), metas, showRatings);
  for (const entry of entries) cacheFilmMapping(entry.film);
  return metas;
}

// ─── Popular ──────────────────────────────────────────────────────────────────

export async function fetchPopularCatalogPublic(
  skip: number,
  showRatings: boolean,
  sort?: string,
  includeGenre?: string[],
  decade?: number,
): Promise<{ metas: StremioMeta[] }> {
  const isShuffle = sort === 'Shuffle';
  const effectiveSort = isShuffle ? 'FilmPopularityThisWeek' : (sort || 'FilmPopularityThisWeek');
  const cacheKey = cacheKeyPopular(showRatings, sort, includeGenre, decade);

  return servePublicCatalog(popularCatalogCache, POPULAR_FRESH_MS, {
    key: cacheKey,
    maxPages: 10,
    fetchPage: (cursor) => callWithAppToken((token) =>
      rawGetFilms(token, { sort: effectiveSort, perPage: 100, cursor, includeGenre, decade }),
    ),
    toMetas: (films) => filmsToMetas(films, showRatings, true),
    finalize: isShuffle ? shuffleArray : undefined,
    store: (metas) => {
      popularCatalogCache.set(cacheKey, { metas });
      logger.info({ total: metas.length }, 'Public popular fetched');
    },
  }, skip);
}

// ─── Top 250 ──────────────────────────────────────────────────────────────────

export async function fetchTop250CatalogPublic(
  skip: number,
  showRatings: boolean,
  sort?: string,
  includeGenre?: string[],
  decade?: number,
): Promise<{ metas: StremioMeta[] }> {
  const cacheKey = cacheKeyTop250(showRatings, sort, includeGenre, decade);

  return servePublicCatalog(top250CatalogCache, TOP250_FRESH_MS, {
    key: cacheKey,
    maxPages: 5,
    fetchPage: (cursor) => callWithAppToken((token) =>
      rawGetListEntries(token, TOP_250_LIST_ID, { perPage: 100, cursor, sort, includeGenre, decade }),
    ),
    toMetas: (entries) => listEntriesToMetas(entries, showRatings, true),
    store: (metas) => {
      top250CatalogCache.set(cacheKey, { metas });
      logger.info({ total: metas.length }, 'Public top250 fetched');
    },
  }, skip);
}

// ─── Public watchlist ─────────────────────────────────────────────────────────

export async function fetchWatchlistCatalogPublic(
  memberId: string,
  skip: number,
  showRatings: boolean,
  sort?: string,
  includeGenre?: string[],
  decade?: number,
): Promise<{ metas: StremioMeta[] }> {
  const cacheKey = cacheKeyPublicWatchlist(memberId, showRatings, sort, includeGenre, decade);

  return servePublicCatalog(publicWatchlistCache, PUBLIC_WATCHLIST_FRESH_MS, {
    key: cacheKey,
    maxPages: 10,
    fetchPage: (cursor) => callWithAppToken((token) =>
      rawGetWatchlist(token, memberId, { perPage: 100, cursor, sort, includeGenre, decade }),
    ),
    toMetas: (films) => filmsToMetas(films, showRatings, true),
    store: (metas) => {
      publicWatchlistCache.set(cacheKey, { metas });
      logger.info({ total: metas.length, memberId }, 'Public watchlist fetched');
    },
  }, skip);
}

// ─── Public list ──────────────────────────────────────────────────────────────

export async function fetchListCatalogPublic(
  listId: string,
  skip: number,
  showRatings: boolean,
  sort?: string,
  includeGenre?: string[],
  decade?: number,
): Promise<{ metas: StremioMeta[] }> {
  const cacheKey = cacheKeyPublicList(listId, showRatings, sort, includeGenre, decade);

  return servePublicCatalog(publicListCache, PUBLIC_LIST_FRESH_MS, {
    key: cacheKey,
    maxPages: 10,
    fetchPage: (cursor) => callWithAppToken((token) =>
      rawGetListEntries(token, listId, { perPage: 100, cursor, sort, includeGenre, decade }),
    ),
    toMetas: (entries) => listEntriesToMetas(entries, showRatings, false),
    store: (metas) => {
      publicListCache.set(cacheKey, { metas });
      logger.info({ total: metas.length, listId }, 'Public list fetched');
    },
  }, skip);
}

// ─── Public liked films ───────────────────────────────────────────────────────

export async function fetchLikedFilmsCatalogPublic(
  memberId: string,
  skip: number,
  showRatings: boolean,
  sort?: string,
  includeGenre?: string[],
  decade?: number,
): Promise<{ metas: StremioMeta[] }> {
  const isShuffle = sort === 'Shuffle';
  const effectiveSort = isShuffle ? 'DateLatestFirst' : (sort || 'DateLatestFirst');
  const cacheKey = cacheKeyPublicLiked(memberId, showRatings, sort, includeGenre, decade);

  return servePublicCatalog(likedFilmsCache, LIKED_FILMS_FRESH_MS, {
    key: cacheKey,
    maxPages: 10,
    fetchPage: (cursor) => callWithAppToken((token) =>
      rawGetFilms(token, {
        member: memberId,
        memberRelationship: 'Liked',
        includeFriends: 'None',
        sort: effectiveSort,
        perPage: 100,
        cursor,
        includeGenre,
        decade,
      }),
    ),
    toMetas: (films) => filmsToMetas(films, showRatings, false),
    finalize: isShuffle ? shuffleArray : undefined,
    store: (metas) => {
      likedFilmsCache.set(cacheKey, { metas });
      logger.info({ total: metas.length, memberId }, 'Public liked films fetched');
    },
  }, skip);
}

// ─── Public contributor (director/actor/studio) ──────────────────────────────

const CONTRIBUTOR_KIND_TO_API: Record<'d' | 'a' | 's', 'Director' | 'Actor' | 'Studio'> = {
  d: 'Director',
  a: 'Actor',
  s: 'Studio',
};

export async function fetchContributorCatalogPublic(
  contribId: string,
  kind: 'd' | 'a' | 's',
  skip: number,
  showRatings: boolean,
  sort?: string,
): Promise<{ metas: StremioMeta[] }> {
  const apiType = CONTRIBUTOR_KIND_TO_API[kind];
  const cacheKey = cacheKeyPublicContributor(kind, contribId, showRatings, sort);

  return servePublicCatalog(publicContributorCache, PUBLIC_CONTRIBUTOR_FRESH_MS, {
    key: cacheKey,
    maxPages: 10,
    fetchPage: async (cursor) => {
      const response = await callWithAppToken((token) =>
        rawGetContributorContributions(token, contribId, {
          type: apiType,
          perPage: 100,
          cursor,
          sort: sort || 'FilmPopularity',
        }),
      );
      return { items: response.items.map((i) => i.film), cursor: response.cursor };
    },
    toMetas: (films) => filmsToMetas(films, showRatings, false),
    store: (metas) => {
      publicContributorCache.set(cacheKey, { metas });
      logger.info({ total: metas.length, contribId, kind }, 'Public contributor fetched');
    },
  }, skip);
}

// ─── Public catalog request orchestrator ──────────────────────────────────────

export async function handlePublicCatalogRequest(
  cfg: PublicConfig,
  catalogId: string,
  extra?: string,
  memberId?: string | null,
): Promise<{ metas: StremioMeta[] }> {
  const showRatings = cfg.r;

  // Extract sort variant from catalog ID (e.g. "letterboxd-watchlist--shuffle")
  let baseCatalogId = catalogId;
  let sortVariant: string | undefined;
  const variantSep = catalogId.lastIndexOf('--');
  if (variantSep > 0) {
    baseCatalogId = catalogId.substring(0, variantSep);
    sortVariant = catalogId.substring(variantSep + 2);
  }

  const variantConfig = sortVariant ? SORT_VARIANT_KEYS[sortVariant] : undefined;

  // Parse combined filter (sort + genre + decade)
  const parsed = parseCombinedFilter(extra);
  const { skip, includeGenre, decade } = parsed;
  const isShuffle = parsed.isShuffle || variantConfig?.special === 'shuffle';
  const sort = isShuffle ? 'Shuffle' : (parsed.sort || variantConfig?.sort);
  const hideUnreleased = parsed.isReleasedOnly || cfg.h === true;
  const hideNoHomeRelease = cfg.nh === true;

  try {
    // Search catalog (handled separately — returns immediately)
    if (baseCatalogId === 'letterboxd-search') {
      const params = parseExtra(extra);
      const query = params['search'];
      if (!query) return { metas: [] };
      trackEvent('catalog_search', undefined);
      const results = await callWithAppToken((token) => rawSearchFilms(token, query, { perPage: 20 }));
      const metas = transformSearchResultsToMetas(results.items);
      return { metas: await enrichMetasWithCinemeta(metas) };
    }

    let result: { metas: StremioMeta[] } | null = null;
    // Member ID effectivement interrogé (watchlist/liked propres ou externes), pour
    // retrouver le catalogue complet en cache lors du filtrage.
    let resolvedMemberId: string | null | undefined = memberId;

    const inSortVariants = (id: string): boolean => !!cfg.s?.[id]?.length;

    if (baseCatalogId === 'letterboxd-popular' && (cfg.c.popular || inSortVariants(baseCatalogId))) {
      trackEvent('catalog_popular', undefined);
      result = await fetchPopularCatalogPublic(skip, showRatings, sort, includeGenre, decade);
    } else if (baseCatalogId === 'letterboxd-top250' && (cfg.c.top250 || inSortVariants(baseCatalogId))) {
      trackEvent('catalog_top250', undefined);
      result = await fetchTop250CatalogPublic(skip, showRatings, sort, includeGenre, decade);
    } else if (baseCatalogId === 'letterboxd-watchlist' && cfg.u && (cfg.c.watchlist || inSortVariants(baseCatalogId)) && memberId) {
      trackEvent('catalog_watchlist', undefined);
      result = await fetchWatchlistCatalogPublic(memberId, skip, showRatings, sort, includeGenre, decade);
    } else if (baseCatalogId === 'letterboxd-liked-films' && cfg.u && (cfg.c.likedFilms || inSortVariants(baseCatalogId)) && memberId) {
      trackEvent('catalog_liked', undefined);
      result = await fetchLikedFilmsCatalogPublic(memberId, skip, showRatings, sort, includeGenre, decade);
    } else if (baseCatalogId.startsWith('letterboxd-watchlist-')) {
      const username = baseCatalogId.replace('letterboxd-watchlist-', '');
      if (cfg.w?.includes(username) || inSortVariants(baseCatalogId)) {
        trackEvent('catalog_watchlist', undefined, { externalUsername: username });
        const extMemberId = await resolveMemberId(username);
        if (extMemberId) {
          resolvedMemberId = extMemberId;
          result = await fetchWatchlistCatalogPublic(extMemberId, skip, showRatings, sort, includeGenre, decade);
        }
      }
    } else if (baseCatalogId.startsWith('letterboxd-list-')) {
      const listId = baseCatalogId.replace('letterboxd-list-', '');
      if (cfg.l.includes(listId) || inSortVariants(baseCatalogId)) {
        const listName = listNameCache.get(listId);
        trackEvent('catalog_list', undefined, { listId, ...(listName && { listName }) });
        result = await fetchListCatalogPublic(listId, skip, showRatings, sort, includeGenre, decade);
      }
    } else {
      const contribMatch = baseCatalogId.match(/^letterboxd-contributor-([das])-([A-Za-z0-9]+)$/);
      if (contribMatch) {
        const kind = contribMatch[1] as 'd' | 'a' | 's';
        const contribId = contribMatch[2]!;
        if (cfg.f?.some((f) => f.t === kind && f.id === contribId) || inSortVariants(baseCatalogId)) {
          trackEvent('catalog_list', undefined, { contribKind: kind, contribId });
          result = await fetchContributorCatalogPublic(contribId, kind, skip, showRatings, sort);
        }
      }
    }

    if (!result) return { metas: [] };

    if (hideUnreleased) {
      // Filter the full catalog then re-paginate; filtering the sliced page
      // returns short pages and drifts the client's pagination.
      const full = await getFullPublicCatalogFromCache(
        baseCatalogId,
        showRatings,
        sort,
        resolvedMemberId,
        includeGenre,
        decade,
      );
      result = full
        ? { metas: sliceReleased(full, skip, CATALOG_PAGE_SIZE, true) }
        : { metas: filterUnreleasedFilms(result.metas, true) };
    }

    // Precise release-date pass (TMDB) on the paginated page.
    if (hideUnreleased || hideNoHomeRelease) {
      result = {
        metas: await filterFilmsByReleaseData(result.metas, { hideUnreleased, hideNoHomeRelease }),
      };
    }
    result = { metas: await enrichMetasWithCinemeta(result.metas) };
    return result;
  } catch (error) {
    logger.error({ error, catalogId }, 'Failed to fetch public catalog');
    return { metas: [] };
  }
}
