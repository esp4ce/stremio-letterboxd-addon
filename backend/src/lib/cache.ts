import { LRUCache } from 'lru-cache';
import { cacheConfig } from '../config/index.js';

export interface CacheOptions {
  maxSize?: number;
  ttl?: number;
}

export function createCache<T extends NonNullable<unknown>>(options: CacheOptions = {}) {
  return new LRUCache<string, T>({
    max: options.maxSize ?? cacheConfig.maxSize,
    ttl: options.ttl ?? cacheConfig.filmTtl,
  });
}

export interface CachedFilm {
  id: string;
  name: string;
  releaseYear?: number;
  poster?: string;
  imdbId?: string;
  tmdbId?: string;
}

export interface CachedRating {
  filmId: string;
  userRating: number | null;
  watched: boolean;
  liked: boolean;
  inWatchlist: boolean;
  communityRating: number | null;
  communityRatings: number;
}

export const filmCache = createCache<CachedFilm>({
  ttl: cacheConfig.filmTtl,
});

export const userRatingCache = createCache<CachedRating>({
  ttl: 5 * 60 * 1000, // 5 minutes for user-specific data
});

// IMDb ID → Letterboxd ID mapping cache (populated from catalog fetches)
export const imdbToLetterboxdCache = createCache<string>({
  ttl: 60 * 60 * 1000, // 1 hour TTL
});

// User lists cache (short TTL since lists can change)
export const userListsCache = createCache<{
  lists: Array<{ id: string; name: string; filmCount: number }>;
}>({
  ttl: 5 * 60 * 1000, // 5 minutes
});

// Cinemeta film data (from Stremio's Cinemeta addon)
export interface CinemetaFilmData {
  name: string;
  year?: number;
  poster?: string;
  background?: string;
  genres?: string[];
  director?: string[];
  cast?: string[];
  writer?: string[];
  runtime?: string;
  description?: string;
  trailers?: Array<{ source: string; type: string }>;
}

// Cinemeta cache (long TTL since this data rarely changes)
export const cinemetaCache = createCache<CinemetaFilmData>({
  ttl: 60 * 60 * 1000, // 1 hour
});
