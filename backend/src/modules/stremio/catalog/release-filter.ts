import { tmdbConfig } from '../../../config/index.js';
import { createChildLogger } from '../../../lib/logger.js';
import { imdbToTmdbCache, releaseDatesCache, type ReleaseDatesInfo } from '../../../lib/cache.js';
import { mapConcurrent } from '../../../lib/concurrency.js';
import { findTmdbIdByImdbId, getTmdbReleaseDates } from '../../../lib/tmdb-client.js';
import { filterUnreleasedFilms } from './catalog-filter.js';
import type { StremioMeta } from '../catalog.service.js';

const logger = createChildLogger('release-filter');

/**
 * Types TMDB considérés comme une sortie "home" (visionnable chez soi) :
 * 4 = Numérique, 5 = Physique, 6 = TV.
 */
const HOME_RELEASE_TYPES = new Set([4, 5, 6]);

/** Concurrence des lookups TMDB (le client applique déjà son propre sémaphore global). */
const LOOKUP_CONCURRENCY = 10;

export interface ReleaseFilterOptions {
  /** Masquer les films dont la date de sortie réelle est dans le futur (issue #77). */
  hideUnreleased: boolean;
  /** Masquer les films sans sortie numérique / physique / TV disponible (issue #90). */
  hideNoHomeRelease: boolean;
}

/**
 * Décision de conservation pays : on considère TOUS les pays.
 * Un film est gardé dès qu'AU MOINS un pays propose une sortie "home" effective.
 * Choix le plus permissif : évite de sur-filtrer des sorties home réelles mais
 * absentes du marché US (ex. productions européennes ou asiatiques).
 */

/**
 * Normalise la réponse TMDB release_dates en info exploitable et cachable.
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
 * Récupère (avec cache) les infos de dates de sortie TMDB pour un IMDb ID.
 * Retourne null si TMDB est indisponible ou le film introuvable — l'appelant
 * doit alors adopter un fallback gracieux (ne pas sur-filtrer).
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
    logger.warn({ imdbId, err }, 'Lookup TMDB des dates de sortie échoué');
    return null;
  }
}

/**
 * Filtre une liste de metas selon les données de date de sortie réelles (TMDB).
 *
 * - #77 : un film sort plus tard dans l'année courante → masqué (granularité à la date).
 *   Si aucune date TMDB n'est disponible pour ce film, on retombe sur le filtre
 *   annuel historique (`filterUnreleasedFilms`) pour ne pas sur-filtrer.
 * - #90 : un film sans sortie numérique / physique / TV effective → masqué.
 *   Si aucune donnée TMDB n'est disponible, le film est conservé (fallback gracieux).
 *
 * Si aucune option n'est active, la liste est renvoyée telle quelle.
 * Si la clé API TMDB est absente, on retombe entièrement sur le filtre annuel
 * pour `hideUnreleased` et on n'applique aucun filtrage "home release".
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
        // Pas de date TMDB → comportement annuel historique.
        continue;
      }
    }

    if (hideNoHomeRelease && info) {
      const hasHomeRelease = info.homeReleaseDates.some((d) => {
        const ts = Date.parse(d);
        return !Number.isNaN(ts) && ts <= now;
      });
      if (!hasHomeRelease) continue;
    }

    kept.push(meta);
  }

  return kept;
}
