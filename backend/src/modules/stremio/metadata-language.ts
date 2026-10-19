import { tmdbConfig } from '../../config/index.js';
import { createChildLogger } from '../../lib/logger.js';
import { mapConcurrent } from '../../lib/concurrency.js';
import { findLocalizedLogoPath, findLocalizedMovie } from '../../lib/tmdb-client.js';
import { localizedLogoCache, localizedMetadataCache, type LocalizedMetadata } from '../../lib/cache.js';
import { getEntitlement } from '../billing/billing.service.js';
import type { UserPreferences } from '../../db/repositories/user.repository.js';
import type { StremioMeta } from './catalog.service.js';
import { DEFAULT_METADATA_LANGUAGE, METADATA_LANGUAGES } from './metadata-language.constants.js';

const logger = createChildLogger('metadata-language');

const LOCALIZE_CONCURRENCY = 10;
const TMDB_LOGO_BASE = 'https://image.tmdb.org/t/p/w500';

/** The member's Metadata Language when it applies, or null for English. */
export async function resolveMetadataLanguage(
  userId: string,
  preferences: UserPreferences | null,
): Promise<string | null> {
  const language = preferences?.metadataLanguage;
  // English is what catalogs already serve: no Polar call, no TMDB call.
  if (!language || language === DEFAULT_METADATA_LANGUAGE) return null;
  if (!(METADATA_LANGUAGES as readonly string[]).includes(language)) return null;
  return (await getEntitlement(userId)) ? language : null;
}

/**
 * Copies of `metas` with titles and synopses in `language`. Runs before Cinemeta
 * enrichment, which then only fills what is still empty. Never mutates its input:
 * catalog metas are shared with the English catalog caches.
 */
export async function localizeMetas(metas: StremioMeta[], language: string): Promise<StremioMeta[]> {
  const apiKey = tmdbConfig.apiKey;
  if (!apiKey) return metas;

  return mapConcurrent(metas, LOCALIZE_CONCURRENCY, async (meta) => {
    const localized = { ...meta };
    const movie = await getLocalizedMetadata(meta.id, language, apiKey);
    if (!movie) return localized;
    if (isTranslatedTitle(movie, language)) localized.name = movie.title;
    // A description already set is Stremboxd's own text (diary line, friend activity), not a synopsis.
    if (movie.overview && !localized.description) {
      localized.description = localized._rankSuffix
        ? `${movie.overview}\n\n${localized._rankSuffix}`
        : movie.overview;
      delete localized._rankSuffix;
    }
    return localized;
  });
}

/**
 * The film page served from Cinemeta, with its title and synopsis in `language`.
 * Unlike catalog metas, its description is always Cinemeta's English synopsis.
 */
export async function localizeFilmPage(
  meta: Record<string, unknown>,
  imdbId: string,
  language: string,
): Promise<Record<string, unknown>> {
  const apiKey = tmdbConfig.apiKey;
  if (!apiKey) return meta;

  const movie = await getLocalizedMetadata(imdbId, language, apiKey);
  if (!movie) return meta;
  const localized = { ...meta };
  if (isTranslatedTitle(movie, language)) {
    localized['name'] = movie.title;
    // Stremio shows a logo instead of the title: an English one would hide the translation.
    const logoPath = await getLocalizedLogoPath(movie.tmdbId, language, apiKey);
    if (logoPath) localized['logo'] = `${TMDB_LOGO_BASE}${logoPath}`;
    else delete localized['logo'];
  }
  if (movie.overview) localized['description'] = movie.overview;
  return localized;
}

async function getLocalizedLogoPath(tmdbId: number, language: string, apiKey: string): Promise<string | null> {
  const iso639 = language.split('-')[0]!;
  const key = `${tmdbId}:${iso639}`;
  const cached = localizedLogoCache.get(key);
  if (cached !== undefined) return cached || null;

  try {
    const path = await findLocalizedLogoPath(tmdbId, iso639, apiKey);
    localizedLogoCache.set(key, path ?? '');
    return path;
  } catch (err) {
    logger.warn({ tmdbId, language, err }, 'TMDB localized logo lookup failed');
    return null;
  }
}

async function getLocalizedMetadata(
  imdbId: string,
  language: string,
  apiKey: string,
): Promise<LocalizedMetadata | null> {
  const key = `${imdbId}:${language}`;
  const cached = localizedMetadataCache.get(key);
  if (cached) return cached;

  try {
    const movie = await findLocalizedMovie(imdbId, language, apiKey);
    if (movie) localizedMetadataCache.set(key, movie);
    return movie;
  } catch (err) {
    logger.warn({ imdbId, language, err }, 'TMDB localized lookup failed');
    return null;
  }
}

/**
 * TMDB answers an untranslated title with the original one: keep it only when the
 * film was made in the Metadata Language, otherwise English reads better than a
 * foreign script.
 */
function isTranslatedTitle(movie: LocalizedMetadata, language: string): boolean {
  if (!movie.title) return false;
  if (movie.title !== movie.originalTitle) return true;
  return movie.originalLanguage === language.split('-')[0];
}
