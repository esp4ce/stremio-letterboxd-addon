import {
  type AuthenticatedClient,
  type LetterboxdFilm,
  type UserList,
  getList as rawGetList,
} from './letterboxd.client.js';
import {
  filmCache,
  type CachedFilm,
  type CachedRating,
} from '../../lib/cache.js';
import { getFilmRatingData } from '../stremio/meta.service.js';
import { createChildLogger } from '../../lib/logger.js';
import { fetchPageHtml, extractListIdFromListPage } from '../../lib/html-scraper.js';
import { callWithAppToken } from '../../lib/app-client.js';

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
  return getFilmRatingData(client, filmId, { userId });
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

  // Strategy 1: Scrape the public HTML page to extract the list LID (most reliable)
  const listUrl = `https://letterboxd.com/${username}/list/${slug}/`;
  const pageHtml = await fetchPageHtml(listUrl);

  if (pageHtml) {
    const listId = extractListIdFromListPage(pageHtml);
    if (listId) {
      logger.info({ listId, username, slug }, 'Strategy 1: extracted list ID from HTML');
      try {
        const list = await callWithAppToken((token) => rawGetList(token, listId));
        const ownerName = list.owner?.displayName || list.owner?.username || username;
        return { id: list.id, name: list.name, owner: ownerName, filmCount: list.filmCount };
      } catch (err) {
        logger.warn({ listId, err }, 'Strategy 1: API call failed for extracted ID, falling back');
      }
    } else {
      logger.warn({ username, slug }, 'Strategy 1: no list ID found in HTML');
    }
  } else {
    logger.warn({ username, slug }, 'Strategy 1: failed to fetch HTML page');
  }

  // Strategy 2 (fallback): Search member → get lists → match by slug
  const member = await client.searchMemberByUsername(username);
  if (!member) {
    logger.warn({ username }, 'Member not found');
    return null;
  }

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

  const list = allLists.find((l: UserList) => matchesSlug(l.name, slug));

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

function extractWords(text: string): string[] {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[‘’ʼ']/g, '')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 0);
}

function wordsOverlap(nameWords: string[], slugWords: string[]): boolean {
  const nameSet = new Set(nameWords);
  const slugSet = new Set(slugWords);
  const slugInName = slugWords.filter((w) => nameSet.has(w)).length;
  const nameInSlug = nameWords.filter((w) => slugSet.has(w)).length;
  return slugInName >= slugWords.length * 0.8
      && nameInSlug >= nameWords.length * 0.6;
}

function matchesSlug(listName: string, urlSlug: string): boolean {
  const nameWords = extractWords(listName);
  const slugWords = urlSlug.split('-').filter((w) => w.length > 0);
  if (wordsOverlap(nameWords, slugWords)) return true;
  const stripped = urlSlug.replace(/-\d+$/, '');
  if (stripped !== urlSlug) {
    return wordsOverlap(nameWords, stripped.split('-').filter((w) => w.length > 0));
  }
  return false;
}
