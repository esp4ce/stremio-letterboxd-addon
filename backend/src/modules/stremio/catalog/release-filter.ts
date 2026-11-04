import { tmdbConfig } from '../../../config/index.js';
import { createChildLogger } from '../../../lib/logger.js';
import { imdbToTmdbCache, releaseDatesCache, releaseDatesMissCache, type ReleaseDatesInfo } from '../../../lib/cache.js';
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

/** Release dates of a film out for over a year no longer change: keep them a month. */
const SETTLED_RELEASE_AGE_MS = 365 * 24 * 60 * 60 * 1000;
const SETTLED_RELEASE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** TMDB has no such film: it won't have one tomorrow either. */
const NOT_FOUND_TTL_MS = 24 * 60 * 60 * 1000;
/** TMDB failed: retry soon, but not on every catalog page. */
const FAILURE_TTL_MS = 60 * 1000;

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
  if (releaseDatesMissCache.get(imdbId)) return null;

  try {
    let tmdbId: number | null = null;
    const cachedTmdbId = imdbToTmdbCache.get(imdbId);
    if (cachedTmdbId) {
      tmdbId = parseInt(cachedTmdbId, 10);
    } else {
      tmdbId = await findTmdbIdByImdbId(imdbId, apiKey);
      if (tmdbId !== null) imdbToTmdbCache.set(imdbId, String(tmdbId));
    }
    if (tmdbId === null || Number.isNaN(tmdbId)) {
      releaseDatesMissCache.set(imdbId, true, { ttl: NOT_FOUND_TTL_MS });
      return null;
    }

    const results = await getTmdbReleaseDates(tmdbId, apiKey);
    const info = normalizeReleaseDates(results);
    const settled =
      info.earliestRelease !== null && Date.now() - Date.parse(info.earliestRelease) > SETTLED_RELEASE_AGE_MS;
    releaseDatesCache.set(imdbId, info, settled ? { ttl: SETTLED_RELEASE_TTL_MS } : undefined);
    return info;
  } catch (err) {
    logger.warn({ imdbId, err }, 'TMDB release-dates lookup failed');
    releaseDatesMissCache.set(imdbId, true, { ttl: FAILURE_TTL_MS });
    return null;
  }
}

/**
 * True when the decision for this film can depend on TMDB. A film from a past
 * year is out (#77), and one from three or more years ago is past the
 * home-release grace period (#90): their answer is known without a lookup.
 */
function needsReleaseInfo(meta: StremioMeta, options: ReleaseFilterOptions, currentYear: number): boolean {
  if (meta.year === undefined) return true;
  if (options.hideUnreleased && meta.year >= currentYear) return true;
  if (options.hideNoHomeRelease && meta.year > currentYear - 3) return true;
  return false;
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
  const currentYear = new Date(now).getFullYear();
  const infos = await mapConcurrent(metas, LOOKUP_CONCURRENCY, (m) =>
    needsReleaseInfo(m, options, currentYear) ? getReleaseInfo(m.id, apiKey) : Promise.resolve(null),
  );

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
