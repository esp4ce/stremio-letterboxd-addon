import type { StremioMeta } from '../catalog.service.js';
import {
  userCatalogCache,
  popularCatalogCache,
  top250CatalogCache,
  publicWatchlistCache,
  publicListCache,
  publicContributorCache,
  likedFilmsCache,
  recommendationCache,
} from '../../../lib/cache.js';
import { inflightCatalog } from './catalog-loader.js';

// ─── Filter suffix (shared cache key component) ──────────────────────────────

export function filterSuffix(genre?: string[], decade?: number): string {
  const parts: string[] = [];
  if (genre?.length) parts.push(`g:${genre.join(',')}`);
  if (decade) parts.push(`d:${decade}`);
  return parts.length ? `:${parts.join(':')}` : '';
}

// ─── Cache key builders ───────────────────────────────────────────────────────

export function cacheKeyWatchlist(
  userId: string,
  showRatings: boolean,
  sort?: string,
  genre?: string[],
  decade?: number,
): string {
  return `user:${userId}:watchlist:${showRatings}:${sort || 'default'}${filterSuffix(genre, decade)}`;
}

export function cacheKeyDiary(userId: string, showRatings: boolean, sort?: string): string {
  return `user:${userId}:diary:${showRatings}:${sort || 'default'}`;
}

export function cacheKeyFriends(userId: string, showRatings: boolean): string {
  return `user:${userId}:friends:${showRatings}`;
}

export function cacheKeyLiked(
  userId: string,
  showRatings: boolean,
  sort?: string,
  genre?: string[],
  decade?: number,
): string {
  return `user:${userId}:liked:${showRatings}:${sort || 'default'}${filterSuffix(genre, decade)}`;
}

export function cacheKeyList(
  userId: string,
  listId: string,
  showRatings: boolean,
  sort?: string,
  genre?: string[],
  decade?: number,
): string {
  return `user:${userId}:list:${listId}:${showRatings}:${sort || 'default'}${filterSuffix(genre, decade)}`;
}

export function cacheKeyReco(userId: string, sort?: string): string {
  return `reco:${userId}:${sort ?? 'default'}`;
}

export function cacheKeyPopular(
  showRatings: boolean,
  sort?: string,
  genre?: string[],
  decade?: number,
): string {
  return `popular:${showRatings}:${sort || 'FilmPopularityThisWeek'}${filterSuffix(genre, decade)}`;
}

export function cacheKeyTop250(
  showRatings: boolean,
  sort?: string,
  genre?: string[],
  decade?: number,
): string {
  return `top250:${showRatings}:${sort || 'default'}${filterSuffix(genre, decade)}`;
}

export function cacheKeyPublicWatchlist(
  memberId: string,
  showRatings: boolean,
  sort?: string,
  genre?: string[],
  decade?: number,
): string {
  return `watchlist:${memberId}:${showRatings}:${sort || 'default'}${filterSuffix(genre, decade)}`;
}

export function cacheKeyPublicList(
  listId: string,
  showRatings: boolean,
  sort?: string,
  genre?: string[],
  decade?: number,
): string {
  return `list:${listId}:${showRatings}:${sort || 'default'}${filterSuffix(genre, decade)}`;
}

export function cacheKeyPublicLiked(
  memberId: string,
  showRatings: boolean,
  sort?: string,
  genre?: string[],
  decade?: number,
): string {
  return `liked:${memberId}:${showRatings}:${sort || 'default'}${filterSuffix(genre, decade)}`;
}

export function cacheKeyPublicContributor(
  kind: string,
  contribId: string,
  showRatings: boolean,
  sort?: string,
): string {
  return `contrib:${kind}:${contribId}:${showRatings}:${sort || 'default'}`;
}

// ─── Full catalog lookup from cache ──────────────────────────────────────────

/**
 * The full catalog cached under `key`, or the one still loading under it: a page
 * can be served before its catalog is complete (see catalog-loader).
 */
async function cachedOrLoading(
  cache: { get(key: string): { metas: StremioMeta[] } | undefined },
  key: string,
): Promise<StremioMeta[] | undefined> {
  return cache.get(key)?.metas ?? (await inflightCatalog(key));
}

/**
 * Read the full (unpaginated) catalog from the appropriate cache, waiting for it
 * when it is still loading.
 * Returns undefined if not found — caller should fall back to paginated result.
 */
export async function getFullCatalogFromCache(
  catalogId: string,
  userId: string,
  showRatings: boolean,
  sort?: string,
  extMemberId?: string,
  includeGenre?: string[],
  decade?: number,
): Promise<StremioMeta[] | undefined> {
  // `extMemberId` is set for own catalogs served from the public path after a
  // session expiry — check that cache before the authenticated one.
  if (catalogId === 'letterboxd-watchlist') {
    const pub = extMemberId
      ? await cachedOrLoading(publicWatchlistCache, cacheKeyPublicWatchlist(extMemberId, showRatings, sort, includeGenre, decade))
      : undefined;
    return pub ?? cachedOrLoading(userCatalogCache, cacheKeyWatchlist(userId, showRatings, sort, includeGenre, decade));
  }
  if (catalogId === 'letterboxd-diary')
    return cachedOrLoading(userCatalogCache, cacheKeyDiary(userId, showRatings, sort));
  if (catalogId === 'letterboxd-friends')
    return cachedOrLoading(userCatalogCache, cacheKeyFriends(userId, showRatings));
  if (catalogId === 'letterboxd-liked-films') {
    const pub = extMemberId
      ? await cachedOrLoading(likedFilmsCache, cacheKeyPublicLiked(extMemberId, showRatings, sort, includeGenre, decade))
      : undefined;
    return pub ?? cachedOrLoading(userCatalogCache, cacheKeyLiked(userId, showRatings, sort, includeGenre, decade));
  }
  if (catalogId === 'letterboxd-recommended')
    return recommendationCache.get(cacheKeyReco(userId, sort))?.metas;
  if (catalogId === 'letterboxd-popular')
    return cachedOrLoading(popularCatalogCache, cacheKeyPopular(showRatings, sort, includeGenre, decade));
  if (catalogId === 'letterboxd-top250')
    return cachedOrLoading(top250CatalogCache, cacheKeyTop250(showRatings, sort, includeGenre, decade));
  if (catalogId.startsWith('letterboxd-watchlist-') && extMemberId)
    return cachedOrLoading(
      publicWatchlistCache,
      cacheKeyPublicWatchlist(extMemberId, showRatings, sort, includeGenre, decade),
    );
  if (catalogId.startsWith('letterboxd-list-')) {
    const listId = catalogId.replace('letterboxd-list-', '');
    // Public-first path, then the authenticated cache for private lists.
    return (
      (await cachedOrLoading(publicListCache, cacheKeyPublicList(listId, showRatings, sort, includeGenre, decade))) ??
      cachedOrLoading(userCatalogCache, cacheKeyList(userId, listId, showRatings, sort, includeGenre, decade))
    );
  }
  // Contributor catalogs share the public cache even on the authenticated path.
  const contrib = catalogId.match(/^letterboxd-contributor-([das])-([A-Za-z0-9]+)$/);
  if (contrib)
    return cachedOrLoading(
      publicContributorCache,
      cacheKeyPublicContributor(contrib[1]!, contrib[2]!, showRatings, sort),
    );
  return undefined;
}

/**
 * Read the full (unpaginated) catalog from the matching public cache, waiting for
 * it when it is still loading.
 * Returns undefined if not found — the caller should then fall back to the page already served.
 */
export async function getFullPublicCatalogFromCache(
  catalogId: string,
  showRatings: boolean,
  sort?: string,
  memberId?: string | null,
  includeGenre?: string[],
  decade?: number,
): Promise<StremioMeta[] | undefined> {
  if (catalogId === 'letterboxd-popular')
    return cachedOrLoading(popularCatalogCache, cacheKeyPopular(showRatings, sort, includeGenre, decade));
  if (catalogId === 'letterboxd-top250')
    return cachedOrLoading(top250CatalogCache, cacheKeyTop250(showRatings, sort, includeGenre, decade));
  if (catalogId === 'letterboxd-liked-films' && memberId)
    return cachedOrLoading(
      likedFilmsCache,
      cacheKeyPublicLiked(memberId, showRatings, sort, includeGenre, decade),
    );
  if ((catalogId === 'letterboxd-watchlist' || catalogId.startsWith('letterboxd-watchlist-')) && memberId)
    return cachedOrLoading(
      publicWatchlistCache,
      cacheKeyPublicWatchlist(memberId, showRatings, sort, includeGenre, decade),
    );
  if (catalogId.startsWith('letterboxd-list-'))
    return cachedOrLoading(
      publicListCache,
      cacheKeyPublicList(catalogId.replace('letterboxd-list-', ''), showRatings, sort, includeGenre, decade),
    );
  const contrib = catalogId.match(/^letterboxd-contributor-([das])-([A-Za-z0-9]+)$/);
  if (contrib) return cachedOrLoading(publicContributorCache, cacheKeyPublicContributor(contrib[1]!, contrib[2]!, showRatings, sort));
  return undefined;
}
