import {
  type AuthenticatedClient,
  type LetterboxdFilm,
  type UserList,
} from './letterboxd.client.js';
import {
  filmCache,
  userRatingCache,
  type CachedFilm,
  type CachedRating,
} from '../../lib/cache.js';
import { createChildLogger } from '../../lib/logger.js';

const logger = createChildLogger('letterboxd-service');

export type ResolvedFilm = CachedFilm;
export type FilmRating = CachedRating;

function extractExternalId(
  film: LetterboxdFilm,
  type: 'imdb' | 'tmdb'
): string | undefined {
  const link = film.links?.find((l) => l.type === type);
  return link?.id;
}

function getBestPosterUrl(film: LetterboxdFilm): string | undefined {
  if (!film.poster?.sizes?.length) return undefined;
  const sorted = [...film.poster.sizes].sort((a, b) => b.width - a.width);
  return sorted[0]?.url;
}

export async function resolveFilm(
  client: AuthenticatedClient,
  options: {
    title?: string;
    year?: number;
    imdbId?: string;
    tmdbId?: string;
  }
): Promise<ResolvedFilm | null> {
  const cacheKey = JSON.stringify(options);
  const cached = filmCache.get(cacheKey) as ResolvedFilm | undefined;
  if (cached) {
    logger.debug({ cacheKey }, 'Film cache hit');
    return cached;
  }

  let film: LetterboxdFilm | null = null;

  if (options.title) {
    const results = await client.searchFilms(options.title, {
      year: options.year,
      perPage: 10,
    });

    if (results.items.length > 0) {
      film = results.items[0]!;

      if (options.year) {
        const exactMatch = results.items.find(
          (f) => f.releaseYear === options.year
        );
        if (exactMatch) {
          film = exactMatch;
        }
      }

      if (options.imdbId) {
        const imdbMatch = results.items.find(
          (f) => extractExternalId(f, 'imdb') === options.imdbId
        );
        if (imdbMatch) {
          film = imdbMatch;
        }
      }

      if (options.tmdbId) {
        const tmdbMatch = results.items.find(
          (f) => extractExternalId(f, 'tmdb') === options.tmdbId
        );
        if (tmdbMatch) {
          film = tmdbMatch;
        }
      }
    }
  }

  if (!film) {
    logger.debug({ options }, 'Film not found');
    return null;
  }

  const resolved: ResolvedFilm = {
    id: film.id,
    name: film.name,
    releaseYear: film.releaseYear,
    poster: getBestPosterUrl(film),
    imdbId: extractExternalId(film, 'imdb'),
    tmdbId: extractExternalId(film, 'tmdb'),
  };

  filmCache.set(cacheKey, resolved);
  logger.debug({ filmId: resolved.id, name: resolved.name }, 'Film resolved');

  return resolved;
}

export async function getFilmRating(
  client: AuthenticatedClient,
  filmId: string,
  userId: string
): Promise<FilmRating> {
  const cacheKey = `rating:${userId}:${filmId}`;
  const cached = userRatingCache.get(cacheKey) as FilmRating | undefined;
  if (cached) {
    logger.debug({ cacheKey }, 'Rating cache hit');
    return cached;
  }

  const [relationship, statistics] = await Promise.all([
    client.getFilmRelationship(filmId),
    client.getFilmStatistics(filmId),
  ]);

  const rating: FilmRating = {
    filmId,
    userRating: relationship.rating ?? null,
    watched: relationship.watched,
    liked: relationship.liked,
    inWatchlist: relationship.inWatchlist,
    communityRating: statistics.rating ?? null,
    communityRatings: statistics.counts.ratings,
  };

  userRatingCache.set(cacheKey, rating);
  logger.debug({ filmId, userRating: rating.userRating }, 'Film rating fetched');

  return rating;
}

export interface ParsedListUrl {
  username: string;
  slug: string;
}

export function parseLetterboxdListUrl(input: string): ParsedListUrl | null {
  // Match URLs like: https://letterboxd.com/username/list/slug-name/
  const match = input.match(
    /(?:https?:\/\/)?(?:www\.)?letterboxd\.com\/([^/]+)\/list\/([^/]+)/
  );
  if (!match) return null;
  return { username: match[1]!, slug: match[2]! };
}

export interface ResolvedExternalList {
  id: string;
  name: string;
  owner: string;
  filmCount: number;
}

export async function resolveExternalList(
  client: AuthenticatedClient,
  username: string,
  slug: string
): Promise<ResolvedExternalList | null> {
  logger.info({ username, slug }, 'Resolving external list');

  // Step 1: Find the member by username via search
  const member = await client.searchMemberByUsername(username);
  if (!member) {
    logger.warn({ username }, 'Member not found');
    return null;
  }

  // Step 2: Fetch all their lists
  const allLists: UserList[] = [];
  let cursor: string | undefined;
  let page = 0;

  do {
    page++;
    const listsResponse = await client.searchLists({
      member: member.id,
      memberRelationship: 'Owner',
      perPage: 100,
      cursor,
    });
    allLists.push(...listsResponse.items);
    cursor = listsResponse.cursor;
  } while (cursor && page < 5);

  // Step 3: Match list by slug
  const normalizeSlug = (name: string) =>
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

  const list = allLists.find(
    (l: UserList) => normalizeSlug(l.name) === slug
  );

  if (!list) {
    logger.warn({ username, slug, listsCount: allLists.length }, 'List not found by slug');
    return null;
  }

  return {
    id: list.id,
    name: list.name,
    owner: member.displayName || member.username,
    filmCount: list.filmCount,
  };
}
