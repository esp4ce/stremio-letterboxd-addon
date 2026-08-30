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
  // Contributor catalogs share the public cache even on the authenticated path.
  const contrib = catalogId.match(/^letterboxd-contributor-([das])-([A-Za-z0-9]+)$/);
  if (contrib)
    return publicContributorCache.get(
      cacheKeyPublicContributor(contrib[1]!, contrib[2]!, showRatings, sort),
    )?.metas;
  return undefined;
}

/**
 * Lit le catalogue complet (non paginé) depuis le cache public correspondant.
 * Renvoie undefined si absent — l'appelant doit alors se rabattre sur la page déjà servie.
 */
export function getFullPublicCatalogFromCache(
  catalogId: string,
  showRatings: boolean,
  sort?: string,
  memberId?: string | null,
  includeGenre?: string[],
  decade?: number,
): StremioMeta[] | undefined {
  if (catalogId === 'letterboxd-popular')
    return popularCatalogCache.get(cacheKeyPopular(showRatings, sort, includeGenre, decade))?.metas;
  if (catalogId === 'letterboxd-top250')
    return top250CatalogCache.get(cacheKeyTop250(showRatings, sort, includeGenre, decade))?.metas;
  if (catalogId === 'letterboxd-liked-films' && memberId)
    return likedFilmsCache.get(
      cacheKeyPublicLiked(memberId, showRatings, sort, includeGenre, decade),
    )?.metas;
  if ((catalogId === 'letterboxd-watchlist' || catalogId.startsWith('letterboxd-watchlist-')) && memberId)
    return publicWatchlistCache.get(
      cacheKeyPublicWatchlist(memberId, showRatings, sort, includeGenre, decade),
    )?.metas;
  if (catalogId.startsWith('letterboxd-list-'))
    return publicListCache.get(
      cacheKeyPublicList(catalogId.replace('letterboxd-list-', ''), showRatings, sort, includeGenre, decade),
    )?.metas;
  const contrib = catalogId.match(/^letterboxd-contributor-([das])-([A-Za-z0-9]+)$/);
  if (contrib) return publicContributorCache.get(cacheKeyPublicContributor(contrib[1]!, contrib[2]!, showRatings, sort))?.metas;
  return undefined;
}
