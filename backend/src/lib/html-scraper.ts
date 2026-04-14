import { config } from '../config/index.js';

const BOXD_SHORTLINK_REGEX = /https?:\/\/boxd\.it\/([A-Za-z0-9]+)/;
const LIST_SHORTLINK_TAG_REGEX = /<link[^>]+rel="shortlink"[^>]+href="https?:\/\/boxd\.it\/([A-Za-z0-9]+)"/;
const LIST_SHORTLINK_TAG_ALT_REGEX = /href="https?:\/\/boxd\.it\/([A-Za-z0-9]+)"[^>]*rel="shortlink"/;
const LIST_LIKEABLE_IDENTIFIER_REGEX =
  /data-likeable-identifier='([^']+)'/;
const CONTRIBUTOR_SHORTLINK_REGEX =
  /id="url-field-contributor-\d+"[^>]*value="https?:\/\/boxd\.it\/([A-Za-z0-9]+)"/;
const OG_TITLE_REGEX = /<meta\s+property="og:title"\s+content="([^"]+)"/i;
const FIRST_FILM_ITEM_LINK_REGEX = /data-item-link="\/film\/([^"/]+)\//;

const BROWSER_FETCH_OPTIONS: RequestInit = {
  headers: { 'User-Agent': config.CATALOG_USER_AGENT },
  redirect: 'follow',
};

export async function fetchPageHtml(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, { ...BROWSER_FETCH_OPTIONS, signal: controller.signal });
    if (!response.ok) return null;
    return response.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export function extractBoxdShortlinkId(html: string): string | null {
  return html.match(BOXD_SHORTLINK_REGEX)?.[1] ?? null;
}

export function extractListIdFromListPage(html: string): string | null {
  const shortlinkId =
    html.match(LIST_SHORTLINK_TAG_REGEX)?.[1] ??
    html.match(LIST_SHORTLINK_TAG_ALT_REGEX)?.[1];
  if (shortlinkId) return shortlinkId;

  // Extract data-likeable-identifier and decode HTML entities (&#034; / &quot; → ")
  const likeableMatch = html.match(LIST_LIKEABLE_IDENTIFIER_REGEX);
  if (likeableMatch) {
    const decoded = likeableMatch[1]!
      .replace(/&#034;/g, '"')
      .replace(/&quot;/g, '"');
    try {
      const parsed = JSON.parse(decoded) as { type?: string; lid?: string };
      if (parsed.type === 'list' && parsed.lid) return parsed.lid;
    } catch { /* ignore parse errors */ }
  }

  return null;
}

export function extractContributorIdFromPage(html: string): string | null {
  return html.match(CONTRIBUTOR_SHORTLINK_REGEX)?.[1] ?? null;
}

export function extractContributorNameFromPage(html: string): string | null {
  const m = html.match(OG_TITLE_REGEX);
  if (!m?.[1]) return null;
  const raw = m[1]
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
  // og:title for contributor pages is "Films directed by X", "Films starring X", "Films from X"
  return raw.replace(/^Films (?:directed by|starring|from)\s+/i, '') || raw;
}

export function extractFirstFilmSlugFromPage(html: string): string | null {
  return html.match(FIRST_FILM_ITEM_LINK_REGEX)?.[1] ?? null;
}

export async function fetchFilmLidBySlug(slug: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`https://letterboxd.com/film/${encodeURIComponent(slug)}/json/`, {
      ...BROWSER_FETCH_OPTIONS,
      headers: { ...BROWSER_FETCH_OPTIONS.headers, Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { lid?: unknown };
    return typeof data.lid === 'string' && data.lid.length > 0 ? data.lid : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/** Lowercase + strip diacritics + keep only [a-z0-9] — for comparing slugs to display names */
export function normalizeContributorSlugKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}
