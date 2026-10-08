import type { AuthenticatedClient, LetterboxdFilm } from '../letterboxd/letterboxd.client.js';
import { LetterboxdApiError } from '../letterboxd/letterboxd.client.js';
import { filmLookupCache, imdbToLetterboxdCache } from '../../lib/cache.js';
import { createChildLogger } from '../../lib/logger.js';
import { getFullFilmInfoFromCinemeta } from '../stremio/meta.service.js';
import { getImdbId } from '../stremio/catalog.service.js';

const logger = createChildLogger('native-sync-resolver');

const MAX_LINKLESS_LOOKUPS = 3;

/** Cinemeta could not describe the film; worth retrying later, not a verdict on the film. */
export class ResolverUnavailableError extends Error {
  constructor() {
    super('resolver_unavailable');
    this.name = 'ResolverUnavailableError';
  }
}

/**
 * Strict film resolution for writes to a member's public diary. A candidate is accepted only when
 * its own links carry the requested IMDb id; upstream errors propagate instead of reading as "no film".
 * Unlike the catalog lookup there is no same-year or first-result fallback.
 */
export async function resolveFilmForWrite(
  client: AuthenticatedClient,
  imdbId: string,
): Promise<{ letterboxdFilmId: string } | null> {
  const mapped = imdbToLetterboxdCache.get(imdbId);
  if (mapped) return { letterboxdFilmId: mapped };

  const looked = filmLookupCache.get(imdbId);
  if (looked) {
    const film = looked.film as LetterboxdFilm;
    if (getImdbId(film) === imdbId && film.id === looked.letterboxdFilmId) {
      return { letterboxdFilmId: looked.letterboxdFilmId };
    }
    logger.debug('Ignoring unverified film lookup cache entry');
  }

  const accept = (film: LetterboxdFilm) => {
    imdbToLetterboxdCache.set(imdbId, film.id);
    return { letterboxdFilmId: film.id };
  };

  let external: LetterboxdFilm | null = null;
  try {
    external = await client.getFilmByExternalId(imdbId, 'imdb');
  } catch (err) {
    if (!(err instanceof LetterboxdApiError && err.status === 404)) throw err;
  }
  if (external && getImdbId(external) === imdbId) return accept(external);

  const cinemeta = await getFullFilmInfoFromCinemeta(imdbId);
  if (!cinemeta) throw new ResolverUnavailableError();

  const results = await client.searchFilms(cinemeta.name, { year: cinemeta.year, perPage: 10 });

  const verified = results.items.find((film) => getImdbId(film) === imdbId);
  if (verified) return accept(verified);

  const wantedName = cinemeta.name.toLowerCase();
  const linkless = results.items
    .filter(
      (film) =>
        getImdbId(film) === null &&
        film.name.toLowerCase() === wantedName &&
        (cinemeta.year === undefined || film.releaseYear === cinemeta.year),
    )
    .slice(0, MAX_LINKLESS_LOOKUPS);
  for (const candidate of linkless) {
    const full = await client.getFilmByLid(candidate.id);
    if (getImdbId(full) === imdbId) return accept(full);
  }

  logger.debug('No verified film for requested id');
  return null;
}
