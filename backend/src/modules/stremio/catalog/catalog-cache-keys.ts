import type { StremioMeta } from '../catalog.service.js';
import {
  userCatalogCache,
  popularCatalogCache,
  top250CatalogCache,
  publicWatchlistCache,
  recommendationCache,
} from '../../../lib/cache.js';

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

// ─── Full catalog lookup from cache ──────────────────────────────────────────

/**
 * Read the full (unpaginated) catalog from the appropriate cache.
 * Returns undefined if not found — caller should fall back to paginated result.
 */
export function getFullCatalogFromCache(
  catalogId: string,
  userId: string,
  showRatings: boolean,
  sort?: string,
  extMemberId?: string,
  includeGenre?: string[],
  decade?: number,
): StremioMeta[] | undefined {
  if (catalogId === 'letterboxd-watchlist')
    return userCatalogCache.get(cacheKeyWatchlist(userId, showRatings, sort, includeGenre, decade))?.metas;
  if (catalogId === 'letterboxd-diary')
    return userCatalogCache.get(cacheKeyDiary(userId, showRatings, sort))?.metas;
  if (catalogId === 'letterboxd-friends')
    return userCatalogCache.get(cacheKeyFriends(userId, showRatings))?.metas;
  if (catalogId === 'letterboxd-liked-films')
    return userCatalogCache.get(cacheKeyLiked(userId, showRatings, sort, includeGenre, decade))?.metas;
  if (catalogId === 'letterboxd-recommended')
    return recommendationCache.get(cacheKeyReco(userId, sort))?.metas;
  if (catalogId === 'letterboxd-popular')
    return popularCatalogCache.get(cacheKeyPopular(showRatings, sort, includeGenre, decade))?.metas;
  if (catalogId === 'letterboxd-top250')
    return top250CatalogCache.get(cacheKeyTop250(showRatings, sort, includeGenre, decade))?.metas;
  if (catalogId.startsWith('letterboxd-watchlist-') && extMemberId)
    return publicWatchlistCache.get(
      cacheKeyPublicWatchlist(extMemberId, showRatings, sort, includeGenre, decade),
    )?.metas;
  if (catalogId.startsWith('letterboxd-list-')) {
    const listId = catalogId.replace('letterboxd-list-', '');
    return userCatalogCache.get(
      cacheKeyList(userId, listId, showRatings, sort, includeGenre, decade),
    )?.metas;
  }
  return undefined;
}
