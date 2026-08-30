import { tmdbConfig } from '../../../config/index.js';
import { createChildLogger } from '../../../lib/logger.js';
import { imdbToTmdbCache, releaseDatesCache, type ReleaseDatesInfo } from '../../../lib/cache.js';
import { mapConcurrent } from '../../../lib/concurrency.js';
import { findTmdbIdByImdbId, getTmdbReleaseDates } from '../../../lib/tmdb-client.js';
import { filterUnreleasedFilms } from './catalog-filter.js';
import type { StremioMeta } from '../catalog.service.js';

const logger = createChildLogger('release-filter');

/**
 * TMDB release types that count as a "home" release (watchable at home):
 * 4 = Digital, 5 = Physical, 6 = TV.
 */
const HOME_RELEASE_TYPES = new Set([4, 5, 6]);

/** Concurrency for TMDB lookups (the client already has its own global semaphore). */
const LOOKUP_CONCURRENCY = 10;

/**
 * Past this delay after the first release, a film is assumed to have a home
 * release even if TMDB doesn't list one: old films are available digitally /
 * physically but their TMDB type 4/5/6 entries are often missing.
 */
const HOME_RELEASE_GRACE_MS = 2 * 365 * 24 * 60 * 60 * 1000;

export interface ReleaseFilterOptions {
  /** Hide films whose real release date is in the future (issue #77). */
  hideUnreleased: boolean;
  /** Hide films with no digital / physical / TV release available (issue #90). */
  hideNoHomeRelease: boolean;
}

/**
 * Country decision: all countries are considered. A film is kept as soon as at
 * least one country has an effective "home" release — the most permissive choice,
 * so real home releases missing from the US market (e.g. European or Asian
 * productions) are not over-filtered.
 */

/**
 * Normalise the TMDB release_dates response into cacheable, usable info.
 */
function normalizeReleaseDates(
  results: Array<{ release_dates: Array<{ type: number; release_date: string }> }>,
): ReleaseDatesInfo {
  let earliest: number | null = null;
  const homeReleaseDates: string[] = [];

  for (const country of results) {
    for (const entry of country.release_dates) {
      if (!entry.release_date) continue;
      const ts = Date.parse(entry.release_date);
      if (Number.isNaN(ts)) continue;
      if (earliest === null || ts < earliest) earliest = ts;
      if (HOME_RELEASE_TYPES.has(entry.type)) homeReleaseDates.push(entry.release_date);
    }
  }

  return {
    earliestRelease: earliest === null ? null : new Date(earliest).toISOString(),
    homeReleaseDates,
  };
}

/**
 * Fetch (cached) the TMDB release-date info for an IMDb ID. Returns null when TMDB
 * is unavailable or the film is not found — the caller must then degrade
 * gracefully (do not over-filter).
 */
async function getReleaseInfo(imdbId: string, apiKey: string): Promise<ReleaseDatesInfo | null> {
  const cached = releaseDatesCache.get(imdbId);
  if (cached) return cached;

  try {
    let tmdbId: number | null = null;
    const cachedTmdbId = imdbToTmdbCache.get(imdbId);
    if (cachedTmdbId) {
      tmdbId = parseInt(cachedTmdbId, 10);
    } else {
      tmdbId = await findTmdbIdByImdbId(imdbId, apiKey);
      if (tmdbId !== null) imdbToTmdbCache.set(imdbId, String(tmdbId));
    }
    if (tmdbId === null || Number.isNaN(tmdbId)) return null;

    const results = await getTmdbReleaseDates(tmdbId, apiKey);
    const info = normalizeReleaseDates(results);
    releaseDatesCache.set(imdbId, info);
    return info;
  } catch (err) {
    logger.warn({ imdbId, err }, 'TMDB release-dates lookup failed');
    return null;
  }
}

/**
 * Filter a list of metas against real release-date data (TMDB).
 *
 * - #77: a film released later this year → hidden (date-level granularity). When
 *   no TMDB date is available, fall back to the historical year check
 *   (`filterUnreleasedFilms`) to avoid over-filtering.
 * - #90: a film with no effective digital / physical / TV release → hidden. It is
 *   kept when no TMDB data is available, or when it was first released more than
 *   two years ago (TMDB rarely lists home releases for old films).
 *
 * If no option is active, the list is returned as-is. If the TMDB API key is
 * missing, fall back entirely to the year check for `hideUnreleased` and apply no
 * home-release filtering.
 */
export async function filterFilmsByReleaseData(
  metas: StremioMeta[],
  options: ReleaseFilterOptions,
): Promise<StremioMeta[]> {
  const { hideUnreleased, hideNoHomeRelease } = options;
  if (!hideUnreleased && !hideNoHomeRelease) return metas;

  const apiKey = tmdbConfig.apiKey;
  if (!apiKey) {
    return hideUnreleased ? filterUnreleasedFilms(metas, true) : metas;
  }

  const now = Date.now();
  const infos = await mapConcurrent(metas, LOOKUP_CONCURRENCY, (m) => getReleaseInfo(m.id, apiKey));

  const kept: StremioMeta[] = [];
  for (let i = 0; i < metas.length; i++) {
    const meta = metas[i]!;
    const info = infos[i] ?? null;

    if (hideUnreleased) {
      if (info?.earliestRelease) {
        if (Date.parse(info.earliestRelease) > now) continue;
      } else if (filterUnreleasedFilms([meta], true).length === 0) {
        // No TMDB date → historical year-based behaviour.
        continue;
      }
    }

    if (hideNoHomeRelease && info) {
      const hasHomeRelease = info.homeReleaseDates.some((d) => {
        const ts = Date.parse(d);
        return !Number.isNaN(ts) && ts <= now;
      });
      const releasedLongAgo =
        info.earliestRelease !== null &&
        now - Date.parse(info.earliestRelease) > HOME_RELEASE_GRACE_MS;
      if (!hasHomeRelease && !releasedLongAgo) continue;
    }

    kept.push(meta);
  }

  return kept;
}
