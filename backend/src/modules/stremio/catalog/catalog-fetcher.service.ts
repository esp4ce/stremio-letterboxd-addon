import {
  WatchlistFilm,
  LogEntry,
  ListEntry,
  ActivityItem,
  UserList,
  searchFilms as rawSearchFilms,
} from '../../letterboxd/letterboxd.client.js';
import {
  transformWatchlistToMetas,
  transformLogEntriesToMetas,
  transformActivityToMetas,
  transformListEntriesToMetas,
  transformSearchResultsToMetas,
  cacheFilmMapping,
  getImdbId,
  getTmdbId,
  getPosterUrl,
  buildPosterUrl,
  enrichMetasWithCinemeta,
} from '../catalog.service.js';
import type { StremioMeta } from '../catalog.service.js';
import { getUserPreferences, findUserById, User } from '../../../db/repositories/user.repository.js';
import { SORT_VARIANT_KEYS } from '../stremio.service.js';
import { trackEvent } from '../../../lib/metrics.js';
import { callWithAppToken } from '../../../lib/app-client.js';
import { getTmdbRecommendations, getTmdbExternalIds } from '../../../lib/tmdb-client.js';
import { tmdbConfig, config } from '../../../config/index.js';
import {
  userListsCache,
  getUserCatalogCached,
  setUserCatalog,
  tmdbToImdbCache,
  listNameCache,
  recommendationCache,
} from '../../../lib/cache.js';
import { createChildLogger } from '../../../lib/logger.js';
import { findFilmByImdb } from '../meta.service.js';
import {
  cacheKeyWatchlist,
  cacheKeyDiary,
  cacheKeyFriends,
  cacheKeyLiked,
  cacheKeyList,
  cacheKeyReco,
  getFullCatalogFromCache,
} from './catalog-cache-keys.js';
import {
  parseCombinedFilter,
  shuffleArray,
  filterUnreleasedFilms,
  parseExtra,
} from './catalog-filter.js';
import { createClientForUser, getWatchedImdbIds, SessionExpiredError } from '../user-client.service.js';
import { fetchPopularCatalogPublic, fetchTop250CatalogPublic, fetchWatchlistCatalogPublic, resolveMemberId, fetchContributorCatalogPublic } from './public-catalog-fetcher.service.js';

const logger = createChildLogger('catalog-fetcher');

// Stremio expects pages of this size
const CATALOG_PAGE_SIZE = 100;

// ─── Watchlist ────────────────────────────────────────────────────────────────

export async function fetchWatchlistCatalog(
  user: User,
  skip: number = 0,
  showRatings: boolean = true,
  sort?: string,
  includeGenre?: string[],
  decade?: number,
): Promise<{ metas: StremioMeta[] }> {
  const cacheKey = cacheKeyWatchlist(user.id, showRatings, sort, includeGenre, decade);
  const cached = getUserCatalogCached(cacheKey, skip, CATALOG_PAGE_SIZE);
  if (cached) return cached;

  const client = await createClientForUser(user);
  const allFilms: WatchlistFilm[] = [];
  let cursor: string | undefined;
  let page = 0;

  do {
    page++;
    const watchlist = await client.getWatchlist({ perPage: 100, cursor, sort, includeGenre, decade });
    logger.info({ page, itemsCount: watchlist.items.length, hasCursor: !!watchlist.cursor }, 'Watchlist page fetched');
    allFilms.push(...watchlist.items);
    cursor = watchlist.cursor;
  } while (cursor && page < 10);

  const allMetas = transformWatchlistToMetas(allFilms, showRatings);
  for (const film of allFilms) cacheFilmMapping(film);

  const result = setUserCatalog(user.id, cacheKey, allMetas, skip, CATALOG_PAGE_SIZE);
  logger.info({ total: allMetas.length, skip, returned: result.metas.length, username: user.letterboxd_username }, 'Watchlist fetched');
  return result;
}

// ─── Diary ────────────────────────────────────────────────────────────────────

export async function fetchDiaryCatalog(
  user: User,
  skip: number = 0,
  showRatings: boolean = true,
  sort?: string,
): Promise<{ metas: StremioMeta[] }> {
  const cacheKey = cacheKeyDiary(user.id, showRatings, sort);
  const cached = getUserCatalogCached(cacheKey, skip, CATALOG_PAGE_SIZE);
  if (cached) return cached;

  const client = await createClientForUser(user);
  const allEntries: LogEntry[] = [];
  let cursor: string | undefined;
  let page = 0;

  do {
    page++;
    const response = await client.getMemberLogEntries({ perPage: 100, cursor, sort });
    logger.info({ page, itemsCount: response.items.length, hasCursor: !!response.cursor }, 'Diary page fetched');
    allEntries.push(...response.items);
    cursor = response.cursor;
  } while (cursor && page < 5);

  const allMetas = transformLogEntriesToMetas(allEntries, showRatings);
  const result = setUserCatalog(user.id, cacheKey, allMetas, skip, CATALOG_PAGE_SIZE);
  logger.info({ total: allMetas.length, skip, returned: result.metas.length, username: user.letterboxd_username }, 'Diary fetched');
  return result;
}

// ─── Friends activity ─────────────────────────────────────────────────────────

export async function fetchFriendsCatalog(
  user: User,
  skip: number = 0,
  showRatings: boolean = true,
): Promise<{ metas: StremioMeta[] }> {
  const cacheKey = cacheKeyFriends(user.id, showRatings);
  const cached = getUserCatalogCached(cacheKey, skip, CATALOG_PAGE_SIZE);
  if (cached) return cached;

  const client = await createClientForUser(user);
  const allItems: ActivityItem[] = [];
  let nextStart: string | undefined;
  let page = 0;

  do {
    page++;
    const response = await client.getFriendsActivity({ perPage: 100, start: nextStart });
    logger.info({ page, itemsCount: response.items.length, hasNext: !!response.next }, 'Friends activity page fetched');
    allItems.push(...response.items);
    nextStart = response.next?.replace('start=', '');
  } while (nextStart && page < 3);

  const allMetas = transformActivityToMetas(allItems, user.letterboxd_id, showRatings);
  const result = setUserCatalog(user.id, cacheKey, allMetas, skip, CATALOG_PAGE_SIZE);
  logger.info({ total: allMetas.length, skip, returned: result.metas.length, username: user.letterboxd_username }, 'Friends activity fetched');
  return result;
}

// ─── List ─────────────────────────────────────────────────────────────────────

export async function fetchListCatalog(
  user: User,
  listId: string,
  skip: number = 0,
  showRatings: boolean = true,
  sort?: string,
  includeGenre?: string[],
  decade?: number,
): Promise<{ metas: StremioMeta[] }> {
  const cacheKey = cacheKeyList(user.id, listId, showRatings, sort, includeGenre, decade);
  const cached = getUserCatalogCached(cacheKey, skip, CATALOG_PAGE_SIZE);
  if (cached) return cached;

  const client = await createClientForUser(user);
  const allEntries: ListEntry[] = [];
  let cursor: string | undefined;
  let page = 0;

  do {
    page++;
    const response = await client.getListEntries(listId, { perPage: 100, cursor, sort, includeGenre, decade });
    logger.info({ page, listId, itemsCount: response.items.length, hasCursor: !!response.cursor }, 'List page fetched');
    allEntries.push(...response.items);
    cursor = response.cursor;
  } while (cursor && page < 10);

  const allMetas = transformListEntriesToMetas(allEntries, showRatings);
  for (const entry of allEntries) cacheFilmMapping(entry.film);

  const result = setUserCatalog(user.id, cacheKey, allMetas, skip, CATALOG_PAGE_SIZE);
  logger.info({ total: allMetas.length, skip, returned: result.metas.length, listId, username: user.letterboxd_username }, 'List fetched');
  return result;
}

// ─── Liked films ──────────────────────────────────────────────────────────────

export async function fetchLikedFilmsCatalog(
  user: User,
  skip: number = 0,
  showRatings: boolean = true,
  sort?: string,
  includeGenre?: string[],
  decade?: number,
): Promise<{ metas: StremioMeta[] }> {
  const cacheKey = cacheKeyLiked(user.id, showRatings, sort, includeGenre, decade);
  const cached = getUserCatalogCached(cacheKey, skip, CATALOG_PAGE_SIZE);
  if (cached) return cached;

  const isShuffle = sort === 'Shuffle';
  const apiSort = isShuffle ? 'DateLatestFirst' : (sort || 'DateLatestFirst');
  const client = await createClientForUser(user);

  const allFilms: WatchlistFilm[] = [];
  let cursor: string | undefined;
  let page = 0;

  do {
    page++;
    const response = await client.getFilms({
      member: user.letterboxd_id,
      memberRelationship: 'Liked',
      includeFriends: 'None',
      sort: apiSort,
      perPage: 100,
      cursor,
      includeGenre,
      decade,
    });
    logger.info({ page, itemsCount: response.items.length, hasCursor: !!response.cursor }, 'Liked films page fetched');
    allFilms.push(...response.items);
    cursor = response.cursor;
  } while (cursor && page < 10);

  let allMetas = transformWatchlistToMetas(allFilms, showRatings);
  if (isShuffle) allMetas = shuffleArray(allMetas);
  for (const film of allFilms) cacheFilmMapping(film);

  const result = setUserCatalog(user.id, cacheKey, allMetas, skip, CATALOG_PAGE_SIZE);
  logger.info({ total: allMetas.length, skip, returned: result.metas.length, username: user.letterboxd_username }, 'Liked films fetched');
  return result;
}

// ─── Recommendations ──────────────────────────────────────────────────────────

export async function fetchRecommendationsCatalog(
  user: User,
  skip: number = 0,
  showRatings: boolean = true,
  sort?: string,
): Promise<{ metas: StremioMeta[] }> {
  const apiKey = tmdbConfig.apiKey;
  if (!apiKey) return { metas: [] };

  const cacheKey = cacheKeyReco(user.id, sort);
  const recoCached = recommendationCache.get(cacheKey);
  if (recoCached) {
    return { metas: recoCached.metas.slice(skip, skip + CATALOG_PAGE_SIZE) };
  }

  const client = await createClientForUser(user);

  // 1. Collect seed films (rated + liked + watchlist in parallel)
  const seeds: WatchlistFilm[] = [];
  const watchlistImdbIds = new Set<string>();
  const watchedImdbIdsFromSeeds = new Set<string>();

  const [ratedResult, likedResult, watchlistFirstPage] = await Promise.allSettled([
    client.getFilms({
      member: user.letterboxd_id,
      memberRelationship: 'Watched',
      sort: 'AuthenticatedMemberRatingHighToLow',
      perPage: 100,
    }),
    client.getFilms({
      member: user.letterboxd_id,
      memberRelationship: 'Liked',
      perPage: 50,
    }),
    client.getWatchlist({ perPage: 100 }),
  ]);

  // Priority 1: rated films (≥3★) — also collect all IMDb IDs for exclusion
  if (ratedResult.status === 'fulfilled') {
    for (const film of ratedResult.value.items) {
      const imdb = getImdbId(film);
      if (imdb) watchedImdbIdsFromSeeds.add(imdb);
    }
    const highRated = ratedResult.value.items.filter((f) => f.rating != null && f.rating >= 3);
    seeds.push(...highRated.slice(0, 50));
  } else {
    logger.warn({ err: ratedResult.reason, userId: user.id }, 'Failed to fetch rated films for recommendations');
  }

  // Priority 2: liked films (weight=1.0)
  if (likedResult.status === 'fulfilled') {
    for (const film of likedResult.value.items) {
      if (seeds.length >= 80) break;
      if (!seeds.some((s) => s.id === film.id)) seeds.push(film);
      const imdb = getImdbId(film);
      if (imdb) watchedImdbIdsFromSeeds.add(imdb);
    }
  } else if (likedResult.status === 'rejected') {
    logger.warn({ err: likedResult.reason, userId: user.id }, 'Failed to fetch liked films for recommendations');
  }

  // Watchlist: paginate remaining pages after first
  if (watchlistFirstPage.status === 'fulfilled') {
    for (const film of watchlistFirstPage.value.items) {
      const imdbId = getImdbId(film);
      if (imdbId) watchlistImdbIds.add(imdbId);
      if (seeds.length < 20 && !seeds.some((s) => s.id === film.id)) seeds.push(film);
    }
    let cursor = watchlistFirstPage.value.cursor;
    let page = 1;
    while (cursor && page < 10) {
      try {
        page++;
        const wl = await client.getWatchlist({ perPage: 100, cursor });
        for (const film of wl.items) {
          const imdbId = getImdbId(film);
          if (imdbId) watchlistImdbIds.add(imdbId);
          if (seeds.length < 20 && !seeds.some((s) => s.id === film.id)) seeds.push(film);
        }
        cursor = wl.cursor;
      } catch (err) {
        logger.warn({ err, userId: user.id }, 'Failed to fetch watchlist page for recommendations');
        break;
      }
    }
  } else {
    logger.warn({ err: watchlistFirstPage.reason, userId: user.id }, 'Failed to fetch watchlist for recommendations');
  }

  if (seeds.length === 0) {
    recommendationCache.set(cacheKey, { metas: [] });
    return { metas: [] };
  }

  // 2. Extract TMDB IDs, keep rating weight per seed
  // Weight: 5★=2.0, 4.5★=1.5, 4★=1.0, 3★=0.5, likes=1.0, watchlist=0.5
  const seedEntries: { tmdbId: number; weight: number }[] = [];
  const seedImdbIds = new Set<string>();
  for (const film of seeds) {
    const tmdbId = getTmdbId(film);
    const imdb = getImdbId(film);
    if (imdb) seedImdbIds.add(imdb);
    cacheFilmMapping(film);
    if (!tmdbId) continue;
    const rating = film.rating;
    const weight = rating == null ? 1.0 : rating >= 5 ? 2.0 : rating >= 4.5 ? 1.5 : rating >= 4 ? 1.0 : 0.5;
    seedEntries.push({ tmdbId, weight });
  }

  // 3. Fan out to TMDB recommendations (max 50 seeds)
  const tmdbSeeds = seedEntries.slice(0, 50);
  const recoResults = await Promise.allSettled(
    tmdbSeeds.map(({ tmdbId }) => getTmdbRecommendations(tmdbId, apiKey)),
  );

  // 4. Aggregate by weighted score
  const scoreMap = new Map<
    number,
    { score: number; title: string; releaseYear?: number; posterPath?: string | null }
  >();
  for (let i = 0; i < recoResults.length; i++) {
    const result = recoResults[i];
    if (result?.status !== 'fulfilled') continue;
    const weight = tmdbSeeds[i]?.weight ?? 1;
    for (const reco of result.value) {
      const existing = scoreMap.get(reco.id);
      if (existing) {
        existing.score += weight;
      } else {
        const year = reco.release_date ? parseInt(reco.release_date.slice(0, 4), 10) : undefined;
        scoreMap.set(reco.id, {
          score: weight,
          title: reco.title,
          releaseYear: year && !isNaN(year) ? year : undefined,
          posterPath: reco.poster_path,
        });
      }
    }
  }

  // 5. Sort by weighted score, keep generous pool before exclusion
  const sorted = [...scoreMap.entries()]
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, 250);

  // 6. Resolve TMDB IDs → IMDb IDs progressively (batch of 30, early-exit when enough)
  const RESOLVE_BATCH_SIZE = 30;
  const RESOLVE_TARGET = 60;
  let resolvedCount = sorted.filter(([id]) => tmdbToImdbCache.get(String(id))).length;

  for (let i = 0; i < sorted.length && resolvedCount < RESOLVE_TARGET; i += RESOLVE_BATCH_SIZE) {
    const batch = sorted
      .slice(i, i + RESOLVE_BATCH_SIZE)
      .filter(([id]) => !tmdbToImdbCache.get(String(id)))
      .map(([id]) => id);

    if (batch.length === 0) continue;

    const results = await Promise.allSettled(
      batch.map((id) => getTmdbExternalIds(id, apiKey).then((ext) => ({ tmdbId: id, imdbId: ext.imdb_id }))),
    );
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value.imdbId) {
        tmdbToImdbCache.set(String(result.value.tmdbId), result.value.imdbId);
        resolvedCount++;
      }
    }
  }

  // 7. Exclude already-watched + watchlist films
  const excludeImdbIds = new Set([...seedImdbIds, ...watchlistImdbIds, ...watchedImdbIdsFromSeeds]);
  try {
    let cursor: string | undefined;
    let page = 0;
    do {
      page++;
      const watched = await client.getFilms({
        member: user.letterboxd_id,
        memberRelationship: 'Watched',
        perPage: 100,
        cursor,
      });
      for (const film of watched.items) {
        const imdb = getImdbId(film);
        if (imdb) excludeImdbIds.add(imdb);
      }
      cursor = watched.cursor;
    } while (cursor && page < 10);
    logger.debug({ excludeCount: excludeImdbIds.size }, 'Watched films collected for exclusion');
  } catch {
    // Non-critical — proceed with partial exclusion
  }

  // 8. Collect final films (after exclusion), capped at 30
  const RECO_LIMIT = 30;
  const finalFilms: Array<{
    imdbId: string;
    tmdb: { title: string; year?: number; posterPath?: string | null };
  }> = [];
  for (const [tmdbId, info] of sorted) {
    if (finalFilms.length >= RECO_LIMIT) break;
    const imdbId = tmdbToImdbCache.get(String(tmdbId));
    if (!imdbId || excludeImdbIds.has(imdbId)) continue;
    finalFilms.push({ imdbId, tmdb: { title: info.title, year: info.releaseYear, posterPath: info.posterPath } });
  }
  logger.info({ finalFilmsCount: finalFilms.length, excludedCount: excludeImdbIds.size }, 'Recommendation pool after exclusion');

  // 9. Fetch Letterboxd community rating for the badge (batch of 10)
  const lbDataMap = new Map<string, { poster?: string; rating?: number }>();
  const LB_BATCH_SIZE = 10;
  for (let i = 0; i < finalFilms.length; i += LB_BATCH_SIZE) {
    const batch = finalFilms.slice(i, i + LB_BATCH_SIZE);
    await Promise.allSettled(
      batch.map(async ({ imdbId }) => {
        const result = await findFilmByImdb(client, imdbId);
        if (!result) return;
        const poster = getPosterUrl(result.film);
        const stats = await client.getFilmStatistics(result.letterboxdFilmId);
        lbDataMap.set(imdbId, { poster, rating: stats.rating ?? undefined });
      }),
    );
  }
  logger.info({ withRating: lbDataMap.size, total: finalFilms.length }, 'Letterboxd data fetched for recommendations');

  // Build StremioMeta[]
  const metas: StremioMeta[] = [];
  let rank = 0;
  for (const { imdbId, tmdb } of finalFilms) {
    rank++;
    const lb = lbDataMap.get(imdbId);
    const posterUrl =
      lb?.poster ?? (tmdb.posterPath ? `https://image.tmdb.org/t/p/w300${tmdb.posterPath}` : undefined);
    metas.push({
      id: imdbId,
      type: 'movie',
      name: tmdb.title,
      poster: showRatings ? buildPosterUrl(posterUrl, lb?.rating) : posterUrl,
      year: tmdb.year,
      description: `#${rank}`,
    });
  }

  // 10. Apply local sort
  if (sort) {
    switch (sort) {
      case 'FilmName':
        metas.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case 'ReleaseDateLatestFirst':
        metas.sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
        break;
      case 'ReleaseDateEarliestFirst':
        metas.sort((a, b) => (a.year ?? 0) - (b.year ?? 0));
        break;
      case 'AverageRatingHighToLow':
        metas.sort((a, b) => (lbDataMap.get(b.id)?.rating ?? 0) - (lbDataMap.get(a.id)?.rating ?? 0));
        break;
      case 'AverageRatingLowToHigh':
        metas.sort((a, b) => (lbDataMap.get(a.id)?.rating ?? 0) - (lbDataMap.get(b.id)?.rating ?? 0));
        break;
      // default: keep score order
    }
    // Re-number ranks after sort
    for (let i = 0; i < metas.length; i++) {
      metas[i]!.description = `#${i + 1}`;
    }
  }

  recommendationCache.set(cacheKey, { metas });
  logger.info({ total: metas.length, seeds: tmdbSeeds.length, username: user.letterboxd_username }, 'Recommendations generated');
  return { metas: metas.slice(skip, skip + CATALOG_PAGE_SIZE) };
}

// ─── User lists ───────────────────────────────────────────────────────────────

export async function fetchUserLists(user: User): Promise<UserList[]> {
  const cacheKey = `lists:${user.letterboxd_id}`;
  const cached = userListsCache.get(cacheKey);
  if (cached) {
    logger.debug({ cacheKey }, 'User lists cache hit');
    return cached.lists;
  }

  const client = await createClientForUser(user);
  const allLists: UserList[] = [];
  let cursor: string | undefined;
  let page = 0;

  do {
    page++;
    const response = await client.getUserLists({ perPage: 50, cursor });
    logger.info({ page, itemsCount: response.items.length, hasCursor: !!response.cursor }, 'Lists page fetched');
    allLists.push(...response.items);
    cursor = response.cursor;
  } while (cursor && page < 3);

  userListsCache.set(cacheKey, { lists: allLists });
  logger.info({ count: allLists.length, username: user.letterboxd_username }, 'User lists fetched');
  return allLists;
}

// ─── Catalog request orchestrator (authenticated) ─────────────────────────────

export async function handleCatalogRequest(
  userId: string,
  type: string,
  catalogId: string,
  extra?: string,
): Promise<{ metas: StremioMeta[] }> {
  const user = findUserById(userId);
  if (!user) throw new Error('User not found');

  logger.info({ type, catalogId, extra, username: user.letterboxd_username }, 'Catalog request');

  if (type !== 'movie') return { metas: [] };

  // Extract sort variant from catalog ID (e.g. "letterboxd-watchlist--shuffle")
  let baseCatalogId = catalogId;
  let sortVariant: string | undefined;
  const variantSep = catalogId.lastIndexOf('--');
  if (variantSep > 0) {
    baseCatalogId = catalogId.substring(0, variantSep);
    sortVariant = catalogId.substring(variantSep + 2);
  }

  const variantConfig = sortVariant ? SORT_VARIANT_KEYS[sortVariant] : undefined;
  const variantSort = variantConfig?.sort;
  const isVariantShuffle = variantConfig?.special === 'shuffle';
  const isVariantNotWatched = variantConfig?.special === 'notWatched';

  const preferences = getUserPreferences(user);
  const showRatings = preferences?.showRatings !== false;

  const parsed = parseCombinedFilter(extra);
  const { skip } = parsed;
  const isShuffle = parsed.isShuffle || isVariantShuffle;
  const sort = isShuffle ? 'Shuffle' : (parsed.sort || variantSort);
  const isNotWatched = parsed.isNotWatched || isVariantNotWatched;
  const isReleasedOnly = parsed.isReleasedOnly;
  const hideUnreleased = isReleasedOnly || preferences?.hideUnreleased === true;
  const includeGenre = parsed.includeGenre;
  const decade = parsed.decade;

  // "Not Watched" needs the full catalog from position 0
  const fetchSkip = isNotWatched ? 0 : skip;

  try {
    let result: { metas: StremioMeta[] };
    let resolvedExtMemberId: string | undefined;

    if (baseCatalogId === 'letterboxd-watchlist') {
      trackEvent('catalog_watchlist', userId);
      result = await fetchWatchlistCatalog(user, fetchSkip, showRatings, sort, includeGenre, decade);
    } else if (baseCatalogId === 'letterboxd-diary') {
      trackEvent('catalog_diary', userId);
      result = await fetchDiaryCatalog(user, fetchSkip, showRatings, sort);
    } else if (baseCatalogId === 'letterboxd-friends') {
      trackEvent('catalog_friends', userId);
      result = await fetchFriendsCatalog(user, fetchSkip, showRatings);
    } else if (baseCatalogId === 'letterboxd-liked-films') {
      trackEvent('catalog_liked', userId);
      result = await fetchLikedFilmsCatalog(user, fetchSkip, showRatings, sort, includeGenre, decade);
    } else if (baseCatalogId === 'letterboxd-recommended') {
      trackEvent('catalog_recommended', userId);
      result = await fetchRecommendationsCatalog(user, fetchSkip, showRatings, sort);
    } else if (baseCatalogId === 'letterboxd-popular') {
      trackEvent('catalog_popular', userId);
      result = await fetchPopularCatalogPublic(fetchSkip, showRatings, sort, includeGenre, decade);
    } else if (baseCatalogId === 'letterboxd-top250') {
      trackEvent('catalog_top250', userId);
      result = await fetchTop250CatalogPublic(fetchSkip, showRatings, sort, includeGenre, decade);
    } else if (baseCatalogId.startsWith('letterboxd-watchlist-')) {
      const username = baseCatalogId.replace('letterboxd-watchlist-', '');
      trackEvent('catalog_watchlist', userId, { externalUsername: username });
      resolvedExtMemberId = (await resolveMemberId(username)) ?? undefined;
      result = resolvedExtMemberId
        ? await fetchWatchlistCatalogPublic(resolvedExtMemberId, fetchSkip, showRatings, sort, includeGenre, decade)
        : { metas: [] };
    } else if (baseCatalogId.startsWith('letterboxd-list-')) {
      const listId = baseCatalogId.replace('letterboxd-list-', '');
      const listName = listNameCache.get(listId);
      trackEvent('catalog_list', userId, { listId, ...(listName && { listName }) });
      result = await fetchListCatalog(user, listId, fetchSkip, showRatings, sort, includeGenre, decade);
    } else if (baseCatalogId.startsWith('letterboxd-contributor-')) {
      const m = baseCatalogId.match(/^letterboxd-contributor-([das])-([A-Za-z0-9]+)$/);
      if (m && preferences?.contributors?.some((c) => c.t === m[1] && c.id === m[2])) {
        const kind = m[1] as 'd' | 'a' | 's';
        const contribId = m[2]!;
        trackEvent('catalog_list', userId, { contribKind: kind, contribId });
        result = await fetchContributorCatalogPublic(contribId, kind, fetchSkip, showRatings, sort);
      } else {
        return { metas: [] };
      }
    } else if (baseCatalogId === 'letterboxd-search') {
      const params = parseExtra(extra);
      const query = params['search'];
      if (!query) return { metas: [] };
      trackEvent('catalog_search', userId);
      const results = await callWithAppToken((token) => rawSearchFilms(token, query, { perPage: 20 }));
      const metas = transformSearchResultsToMetas(results.items);
      return { metas: await enrichMetasWithCinemeta(metas) };
    } else {
      logger.warn({ catalogId: baseCatalogId }, 'Unknown catalog requested');
      return { metas: [] };
    }

    // "Not Watched" filter: get full catalog, remove watched films, re-paginate
    if (isNotWatched) {
      const fullMetas = getFullCatalogFromCache(
        baseCatalogId,
        user.id,
        showRatings,
        sort,
        resolvedExtMemberId,
        includeGenre,
        decade,
      );
      if (fullMetas) {
        const watchedIds = await getWatchedImdbIds(user);
        const filtered = fullMetas.filter((m) => !watchedIds.has(m.id));
        logger.info(
          { catalogId: baseCatalogId, total: fullMetas.length, filtered: filtered.length, watched: watchedIds.size },
          'Not Watched filter applied',
        );
        result = { metas: filtered.slice(skip, skip + CATALOG_PAGE_SIZE) };
      }
    }

    result = { metas: filterUnreleasedFilms(result.metas, hideUnreleased) };
    result = { metas: await enrichMetasWithCinemeta(result.metas) };
    return result;
  } catch (error) {
    if (error instanceof SessionExpiredError) {
      logger.warn({ userId, catalogId }, 'Session expired — returning reconnect prompt');
      const configureUrl = config.CORS_ORIGIN.split(',')[0]?.trim() + '/configure';
      return {
        metas: [
          {
            id: 'letterboxd-session-expired',
            type: 'movie' as const,
            name: 'Session Expired — Please Reconnect',
            description: `Your session has expired. Visit ${configureUrl} to reconnect your account.`,
          },
        ],
      };
    }
    logger.error({ error, userId, catalogId }, 'Failed to fetch catalog');
    return { metas: [] };
  }
}
