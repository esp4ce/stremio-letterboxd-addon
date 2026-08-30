import { createChildLogger } from './logger.js';

const logger = createChildLogger('tmdb-client');

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const MAX_CONCURRENT = 10;
const MAX_RETRIES = 2;
const RETRY_BASE_DELAY = 1000;

export interface TmdbRecommendation {
  id: number;
  title: string;
  release_date?: string;
  poster_path?: string | null;
  vote_average?: number;
}

interface TmdbRecommendationsResponse {
  results: TmdbRecommendation[];
}

interface TmdbExternalIds {
  imdb_id?: string | null;
}

class Semaphore {
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly max: number) {}

  acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.queue.push(() => {
        this.active++;
        resolve();
      });
    });
  }

  release(): void {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  }
}

// Global semaphore — TMDB rate limits are per API key, not per user
const semaphore = new Semaphore(MAX_CONCURRENT);

async function tmdbFetch<T>(url: string): Promise<T> {
  await semaphore.acquire();
  try {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const response = await fetch(url);

      if (response.status === 429 && attempt < MAX_RETRIES) {
        const retryAfter = response.headers.get('retry-after');
        const delay = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : RETRY_BASE_DELAY * Math.pow(2, attempt);
        logger.warn({ attempt, delay }, 'TMDB rate limited, retrying');
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      if (!response.ok) {
        throw new Error(`TMDB API error: ${response.status} ${response.statusText}`);
      }

      return (await response.json()) as T;
    }
    throw new Error('TMDB API: max retries exceeded');
  } finally {
    semaphore.release();
  }
}

export async function getTmdbRecommendations(
  tmdbId: number,
  apiKey: string,
): Promise<TmdbRecommendation[]> {
  const url = `${TMDB_BASE_URL}/movie/${tmdbId}/recommendations?api_key=${apiKey}&language=en-US&page=1`;
  const data = await tmdbFetch<TmdbRecommendationsResponse>(url);
  return data.results ?? [];
}

export async function getTmdbExternalIds(
  tmdbId: number,
  apiKey: string,
): Promise<TmdbExternalIds> {
  const url = `${TMDB_BASE_URL}/movie/${tmdbId}/external_ids?api_key=${apiKey}`;
  return tmdbFetch<TmdbExternalIds>(url);
}

interface TmdbFindResponse {
  movie_results?: Array<{ id: number }>;
}

/**
 * Resolve an IMDb ID to a TMDB ID via the /find endpoint. Returns null when
 * there is no match.
 */
export async function findTmdbIdByImdbId(
  imdbId: string,
  apiKey: string,
): Promise<number | null> {
  const url = `${TMDB_BASE_URL}/find/${encodeURIComponent(imdbId)}?api_key=${apiKey}&external_source=imdb_id`;
  const data = await tmdbFetch<TmdbFindResponse>(url);
  return data.movie_results?.[0]?.id ?? null;
}

export interface TmdbReleaseDateEntry {
  /** Type TMDB : 1 Premiere, 2 Theatrical (limited), 3 Theatrical, 4 Digital, 5 Physical, 6 TV */
  type: number;
  release_date: string;
}

export interface TmdbReleaseDatesResult {
  iso_3166_1: string;
  release_dates: TmdbReleaseDateEntry[];
}

interface TmdbReleaseDatesResponse {
  results?: TmdbReleaseDatesResult[];
}

/**
 * Fetch the detailed release dates of a TMDB movie (per country and per type).
 */
export async function getTmdbReleaseDates(
  tmdbId: number,
  apiKey: string,
): Promise<TmdbReleaseDatesResult[]> {
  const url = `${TMDB_BASE_URL}/movie/${tmdbId}/release_dates?api_key=${apiKey}`;
  const data = await tmdbFetch<TmdbReleaseDatesResponse>(url);
  return data.results ?? [];
}

export interface TmdbMovieDetails {
  adult: boolean;
  poster_path: string | null;
}

export async function getTmdbMovieDetails(
  tmdbId: number,
  apiKey: string,
): Promise<TmdbMovieDetails> {
  const url = `${TMDB_BASE_URL}/movie/${tmdbId}?api_key=${apiKey}&language=en-US`;
  return tmdbFetch<TmdbMovieDetails>(url);
}
