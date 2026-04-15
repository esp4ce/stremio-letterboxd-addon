import { genreNameToCode } from '../../letterboxd/letterboxd.client.js';
import { SORT_LABEL_TO_API } from '../stremio.service.js';
import type { StremioMeta } from '../catalog.service.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ParsedCombinedFilter {
  skip: number;
  includeGenre?: string[];
  decade?: number;
  sort?: string;
  isShuffle: boolean;
  isNotWatched: boolean;
  isReleasedOnly: boolean;
}

// ─── Extra params parser ──────────────────────────────────────────────────────

/**
 * Parse Stremio extra params like "skip=20" or "genre=Action"
 */
export function parseExtra(extra?: string): Record<string, string> {
  if (!extra) return {};
  const params: Record<string, string> = {};
  const parts = extra.split('&');
  for (const part of parts) {
    const [key, value] = part.split('=');
    if (key && value !== undefined) {
      params[key] = decodeURIComponent(value);
    }
  }
  return params;
}

// ─── Combined filter parser ───────────────────────────────────────────────────

/**
 * Parse the combined "genre" extra param which carries sort, genre, and decade signals.
 */
export function parseCombinedFilter(extra?: string): ParsedCombinedFilter {
  const params = parseExtra(extra);
  const skip = params['skip'] ? parseInt(params['skip'], 10) : 0;
  const label = params['genre'];

  if (!label) return { skip, isShuffle: false, isNotWatched: false, isReleasedOnly: false };

  // Sort detection
  if (label === 'Shuffle') return { skip, isShuffle: true, isNotWatched: false, isReleasedOnly: false };
  if (label === 'Not Watched') return { skip, isShuffle: false, isNotWatched: true, isReleasedOnly: false };
  if (label === 'Released Only') return { skip, isShuffle: false, isNotWatched: false, isReleasedOnly: true };
  if (SORT_LABEL_TO_API[label])
    return { skip, sort: SORT_LABEL_TO_API[label], isShuffle: false, isNotWatched: false, isReleasedOnly: false };

  // Decade detection: "1990s" → 1990
  const decadeMatch = label.match(/^(\d{4})s$/);
  if (decadeMatch)
    return { skip, decade: parseInt(decadeMatch[1]!, 10), isShuffle: false, isNotWatched: false, isReleasedOnly: false };

  // Genre detection: "Comedy" → ['7I']
  const code = genreNameToCode(label);
  if (code)
    return { skip, includeGenre: [code], isShuffle: false, isNotWatched: false, isReleasedOnly: false };

  return { skip, isShuffle: false, isNotWatched: false, isReleasedOnly: false };
}

// ─── Shuffle ──────────────────────────────────────────────────────────────────

/**
 * Fisher-Yates shuffle for server-side randomization.
 * Used for endpoints that don't support sort=Shuffle natively (e.g. /films).
 */
export function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

// ─── Unreleased film filter ───────────────────────────────────────────────────

export function filterUnreleasedFilms(metas: StremioMeta[], hideUnreleased: boolean): StremioMeta[] {
  if (!hideUnreleased) return metas;
  const currentYear = new Date().getFullYear();
  return metas.filter((m) => m.year !== undefined && m.year <= currentYear);
}
