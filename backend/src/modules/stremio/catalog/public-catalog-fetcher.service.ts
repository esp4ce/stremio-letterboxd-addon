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
  cacheFilmMapping,
  enrichMetasWithCinemeta,
} from '../catalog.service.js';
import type { StremioMeta } from '../catalog.service.js';
import type { PublicConfig } from '../../../lib/config-encoding.js';
import { SORT_VARIANT_KEYS } from '../stremio.service.js';
import { trackEvent } from '../../../lib/metrics.js';
import { callWithAppToken } from '../../../lib/app-client.js';
import {
  popularCatalogCache,
  top250CatalogCache,
  publicWatchlistCache,
  publicListCache,
  publicContributorCache,
  likedFilmsCache,
  memberIdCache,
  listNameCache,
} from '../../../lib/cache.js';
import { createChildLogger } from '../../../lib/logger.js';
import {
  cacheKeyPopular,
  cacheKeyTop250,
  cacheKeyPublicWatchlist,
  filterSuffix,
} from './catalog-cache-keys.js';
import { parseCombinedFilter, shuffleArray, filterUnreleasedFilms, parseExtra } from './catalog-filter.js';

const logger = createChildLogger('public-catalog-fetcher');

// Stremio expects pages of this size
const CATALOG_PAGE_SIZE = 100;

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
  const cached = popularCatalogCache.get(cacheKey);
  if (cached) {
    return { metas: cached.metas.slice(skip, skip + CATALOG_PAGE_SIZE) };
  }

  const allFilms: WatchlistFilm[] = [];
  let cursor: string | undefined;
  let page = 0;

  do {
    page++;
    const response = await callWithAppToken((token) =>
      rawGetFilms(token, { sort: effectiveSort, perPage: 100, cursor, includeGenre, decade }),
    );
    allFilms.push(...response.items);
    cursor = response.cursor;
  } while (cursor && page < 10);

  let allMetas = transformWatchlistToMetas(allFilms, showRatings);
  if (isShuffle) allMetas = shuffleArray(allMetas);
  for (const film of allFilms) cacheFilmMapping(film);

  popularCatalogCache.set(cacheKey, { metas: allMetas });
  const metas = allMetas.slice(skip, skip + CATALOG_PAGE_SIZE);
  logger.info({ total: allMetas.length, skip, returned: metas.length }, 'Public popular fetched');
  return { metas };
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
  const cached = top250CatalogCache.get(cacheKey);
  if (cached) {
    return { metas: cached.metas.slice(skip, skip + CATALOG_PAGE_SIZE) };
  }

  const allEntries: ListEntry[] = [];
  let cursor: string | undefined;
  let page = 0;

  do {
    page++;
    const response = await callWithAppToken((token) =>
      rawGetListEntries(token, TOP_250_LIST_ID, { perPage: 100, cursor, sort, includeGenre, decade }),
    );
    allEntries.push(...response.items);
    cursor = response.cursor;
  } while (cursor && page < 5);

  const allMetas = transformListEntriesToMetas(allEntries, showRatings);
  for (const entry of allEntries) cacheFilmMapping(entry.film);

  top250CatalogCache.set(cacheKey, { metas: allMetas });
  const metas = allMetas.slice(skip, skip + CATALOG_PAGE_SIZE);
  logger.info({ total: allMetas.length, skip, returned: metas.length }, 'Public top250 fetched');
  return { metas };
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
  const cached = publicWatchlistCache.get(cacheKey);
  if (cached) {
    return { metas: cached.metas.slice(skip, skip + CATALOG_PAGE_SIZE) };
  }

  const allFilms: WatchlistFilm[] = [];
  let cursor: string | undefined;
  let page = 0;

  do {
    page++;
    const response = await callWithAppToken((token) =>
      rawGetWatchlist(token, memberId, { perPage: 100, cursor, sort, includeGenre, decade }),
    );
    allFilms.push(...response.items);
    cursor = response.cursor;
  } while (cursor && page < 10);

  const allMetas = transformWatchlistToMetas(allFilms, showRatings);
  for (const film of allFilms) cacheFilmMapping(film);

  publicWatchlistCache.set(cacheKey, { metas: allMetas });
  const metas = allMetas.slice(skip, skip + CATALOG_PAGE_SIZE);
  logger.info({ total: allMetas.length, skip, returned: metas.length, memberId }, 'Public watchlist fetched');
  return { metas };
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
  const cacheKey = `list:${listId}:${showRatings}:${sort || 'default'}${filterSuffix(includeGenre, decade)}`;
  const cached = publicListCache.get(cacheKey);
  if (cached) {
    return { metas: cached.metas.slice(skip, skip + CATALOG_PAGE_SIZE) };
  }

  const allEntries: ListEntry[] = [];
  let cursor: string | undefined;
  let page = 0;

  do {
    page++;
    const response = await callWithAppToken((token) =>
      rawGetListEntries(token, listId, { perPage: 100, cursor, sort, includeGenre, decade }),
    );
    allEntries.push(...response.items);
    cursor = response.cursor;
  } while (cursor && page < 10);

  const allMetas = transformListEntriesToMetas(allEntries, showRatings);
  for (const entry of allEntries) cacheFilmMapping(entry.film);

  publicListCache.set(cacheKey, { metas: allMetas });
  const metas = allMetas.slice(skip, skip + CATALOG_PAGE_SIZE);
  logger.info({ total: allMetas.length, skip, returned: metas.length, listId }, 'Public list fetched');
  return { metas };
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
  const cacheKey = `liked:${memberId}:${showRatings}:${sort || 'default'}${filterSuffix(includeGenre, decade)}`;
  const cached = likedFilmsCache.get(cacheKey);
  if (cached) {
    return { metas: cached.metas.slice(skip, skip + CATALOG_PAGE_SIZE) };
  }

  const allFilms: WatchlistFilm[] = [];
  let cursor: string | undefined;
  let page = 0;

  do {
    page++;
    const response = await callWithAppToken((token) =>
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
    );
    allFilms.push(...response.items);
    cursor = response.cursor;
  } while (cursor && page < 10);

  let allMetas = transformWatchlistToMetas(allFilms, showRatings);
  if (isShuffle) allMetas = shuffleArray(allMetas);
  for (const film of allFilms) cacheFilmMapping(film);

  likedFilmsCache.set(cacheKey, { metas: allMetas });
  const metas = allMetas.slice(skip, skip + CATALOG_PAGE_SIZE);
  logger.info({ total: allMetas.length, skip, returned: metas.length, memberId }, 'Public liked films fetched');
  return { metas };
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
  const cacheKey = `contrib:${kind}:${contribId}:${showRatings}:${sort || 'default'}`;
  const cached = publicContributorCache.get(cacheKey);
  if (cached) {
    return { metas: cached.metas.slice(skip, skip + CATALOG_PAGE_SIZE) };
  }

  const allFilms: WatchlistFilm[] = [];
  let cursor: string | undefined;
  let page = 0;

  do {
    page++;
    const response = await callWithAppToken((token) =>
      rawGetContributorContributions(token, contribId, {
        type: apiType,
        perPage: 100,
        cursor,
        sort: sort || 'FilmPopularity',
      }),
    );
    allFilms.push(...response.items.map((i) => i.film));
    cursor = response.cursor;
  } while (cursor && page < 10);

  const allMetas = transformWatchlistToMetas(allFilms, showRatings);
  for (const film of allFilms) cacheFilmMapping(film);

  publicContributorCache.set(cacheKey, { metas: allMetas });
  const metas = allMetas.slice(skip, skip + CATALOG_PAGE_SIZE);
  logger.info({ total: allMetas.length, skip, returned: metas.length, contribId, kind }, 'Public contributor fetched');
  return { metas };
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

    if (baseCatalogId === 'letterboxd-popular' && cfg.c.popular) {
      trackEvent('catalog_popular', undefined);
      result = await fetchPopularCatalogPublic(skip, showRatings, sort, includeGenre, decade);
    } else if (baseCatalogId === 'letterboxd-top250' && cfg.c.top250) {
      trackEvent('catalog_top250', undefined);
      result = await fetchTop250CatalogPublic(skip, showRatings, sort, includeGenre, decade);
    } else if (baseCatalogId === 'letterboxd-watchlist' && cfg.u && cfg.c.watchlist && memberId) {
      trackEvent('catalog_watchlist', undefined);
      result = await fetchWatchlistCatalogPublic(memberId, skip, showRatings, sort, includeGenre, decade);
    } else if (baseCatalogId === 'letterboxd-liked-films' && cfg.u && cfg.c.likedFilms && memberId) {
      trackEvent('catalog_liked', undefined);
      result = await fetchLikedFilmsCatalogPublic(memberId, skip, showRatings, sort, includeGenre, decade);
    } else if (baseCatalogId.startsWith('letterboxd-watchlist-')) {
      const username = baseCatalogId.replace('letterboxd-watchlist-', '');
      if (cfg.w?.includes(username)) {
        trackEvent('catalog_watchlist', undefined, { externalUsername: username });
        const extMemberId = await resolveMemberId(username);
        if (extMemberId) {
          result = await fetchWatchlistCatalogPublic(extMemberId, skip, showRatings, sort, includeGenre, decade);
        }
      }
    } else if (baseCatalogId.startsWith('letterboxd-list-')) {
      const listId = baseCatalogId.replace('letterboxd-list-', '');
      if (cfg.l.includes(listId)) {
        const listName = listNameCache.get(listId);
        trackEvent('catalog_list', undefined, { listId, ...(listName && { listName }) });
        result = await fetchListCatalogPublic(listId, skip, showRatings, sort, includeGenre, decade);
      }
    } else {
      const contribMatch = baseCatalogId.match(/^letterboxd-contributor-([das])-([A-Za-z0-9]+)$/);
      if (contribMatch) {
        const kind = contribMatch[1] as 'd' | 'a' | 's';
        const contribId = contribMatch[2]!;
        if (cfg.f?.some((f) => f.t === kind && f.id === contribId)) {
          trackEvent('catalog_list', undefined, { contribKind: kind, contribId });
          result = await fetchContributorCatalogPublic(contribId, kind, skip, showRatings, sort);
        }
      }
    }

    if (!result) return { metas: [] };

    result = { metas: filterUnreleasedFilms(result.metas, hideUnreleased) };
    result = { metas: await enrichMetasWithCinemeta(result.metas) };
    return result;
  } catch (error) {
    logger.error({ error, catalogId }, 'Failed to fetch public catalog');
    return { metas: [] };
  }
}
