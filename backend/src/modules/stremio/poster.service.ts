import sharp from 'sharp';
import { posterCache } from '../../lib/cache.js';
import { createChildLogger } from '../../lib/logger.js';
import { assertAllowedUrl } from '../../lib/url-allowlist.js';

const logger = createChildLogger('poster-service');

// Exact hosts (no wildcard) that may be proxied in addition to the shared allowlist:
// Cinemeta poster CDN (Tier 2/3 meta) and TMDB images (adult-poster fix).
export const POSTER_EXTRA_HOSTS: ReadonlySet<string> = new Set([
  'images.metahub.space',
  'image.tmdb.org',
]);

/** Single source of truth for the /poster route and generateRatedPoster. */
export function isAllowedPosterUrl(url: string): boolean {
  try {
    assertAllowedUrl(url, { extraHosts: POSTER_EXTRA_HOSTS });
    return true;
  } catch {
    return false;
  }
}

const POSTER_LABEL_MAX_LENGTH = 24;
const POSTER_LABEL_FALLBACK = 'Friend';
// Only what the overlay font (DejaVu Sans) can draw. Anything else would render
// as tofu boxes, and keeping this set free of < > " ' & makes the label safe to
// embed in the SVG overlay.
const NON_RENDERABLE_LABEL_CHARS = /[^\p{Script=Latin}\p{N}\s.,\-_·•…★☆♥]/gu;

/** Third-party display name -> short, SVG-safe, renderable overlay label. */
export function sanitizePosterLabel(raw: string): string {
  const cleaned = raw
    .normalize('NFC')
    .replace(NON_RENDERABLE_LABEL_CHARS, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return POSTER_LABEL_FALLBACK;
  return cleaned.length > POSTER_LABEL_MAX_LENGTH
    ? `${cleaned.slice(0, POSTER_LABEL_MAX_LENGTH - 1)}…`
    : cleaned;
}

// Semaphore to limit concurrent poster image fetches (CDN rate-limiting protection)
const MAX_CONCURRENT_FETCHES = 8;
let activeFetches = 0;
const fetchQueue: Array<() => void> = [];

function acquireFetchSlot(): Promise<void> {
  if (activeFetches < MAX_CONCURRENT_FETCHES) {
    activeFetches++;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    fetchQueue.push(() => { activeFetches++; resolve(); });
  });
}

function releaseFetchSlot(): void {
  activeFetches--;
  const next = fetchQueue.shift();
  if (next) next();
}

/**
 * Generate a poster image with a rating badge overlay
 * Minimal cinema aesthetic: white badge, black text
 */
export async function generateRatedPoster(
  posterUrl: string,
  rating?: number,
  by?: string
): Promise<Buffer> {
  const label = by ? sanitizePosterLabel(by) : undefined;
  const cacheKey = `${posterUrl}:${rating ?? ''}:${label ?? ''}`;
  const cached = posterCache.get(cacheKey);
  if (cached) return cached;

  logger.debug({ posterUrl, rating, queueSize: fetchQueue.length }, 'Generating rated poster');

  const safePosterUrl = assertAllowedUrl(posterUrl, { extraHosts: POSTER_EXTRA_HOSTS });

  let response!: Response;
  await acquireFetchSlot();
  try {
    const MAX_RETRIES = 3;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      response = await fetch(safePosterUrl);
      if (response.status === 429 && attempt < MAX_RETRIES) {
        const retryAfter = response.headers.get('retry-after');
        const delay = retryAfter ? parseInt(retryAfter, 10) * 1000 : 1000 * Math.pow(2, attempt);
        logger.warn({ attempt, delay, posterUrl }, 'CDN rate-limited (429), retrying');
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      break;
    }
  } finally {
    releaseFetchSlot();
  }
  if (!response.ok) {
    throw new Error(`Failed to fetch poster: ${response.status}`);
  }

  const imageBuffer = Buffer.from(await response.arrayBuffer());
  const image = sharp(imageBuffer);
  const metadata = await image.metadata();

  const width = metadata.width ?? 300;
  const height = metadata.height ?? 450;

  // Pill badges: dark background, shared geometry
  const badgeH = Math.round(width * 0.13);
  const margin = Math.round(width * 0.04);
  const rx = Math.round(badgeH * 0.5);
  const hPad = Math.round(badgeH * 0.3);
  const fontSize = Math.round(badgeH * 0.50);
  const fontFamily = 'DejaVu Sans, Arial, Helvetica, sans-serif';

  // Bottom-right: Letterboxd 3-dot logo left, community rating right
  let ratingBadge = '';
  if (rating !== undefined) {
    const r = Math.round(badgeH * 0.27);        // circle radius
    const gap = Math.round(r * 1.55);            // center-to-center (slight overlap)
    const ratingText = rating.toFixed(1);
    const logoSectionW = hPad + r + gap * 2 + r + hPad;
    const ratingW = Math.round(fontSize * ratingText.length * 0.65);
    const badgeW = logoSectionW + ratingW + hPad;
    const badgeX = width - badgeW - margin;
    const badgeY = height - badgeH - margin;
    const cy = Math.round(badgeY + badgeH / 2);
    const cx1 = badgeX + hPad + r;
    const cx2 = cx1 + gap;
    const cx3 = cx2 + gap;
    const textX = badgeX + logoSectionW + ratingW / 2;
    const textY = cy + Math.round(fontSize * 0.36);
    ratingBadge = `
      <!-- Dark pill background -->
      <rect x="${badgeX}" y="${badgeY}" width="${badgeW}" height="${badgeH}"
            rx="${rx}" ry="${rx}" fill="#1a1a1a" fill-opacity="0.92"/>
      <!-- Letterboxd 3-dot logo: green, orange, blue -->
      <circle cx="${cx1}" cy="${cy}" r="${r}" fill="#00C030"/>
      <circle cx="${cx2}" cy="${cy}" r="${r}" fill="#FF8000"/>
      <circle cx="${cx3}" cy="${cy}" r="${r}" fill="#40BCF4"/>
      <!-- Subtle divider -->
      <line x1="${badgeX + logoSectionW}" y1="${badgeY + badgeH * 0.2}"
            x2="${badgeX + logoSectionW}" y2="${badgeY + badgeH * 0.8}"
            stroke="white" stroke-opacity="0.2" stroke-width="1"/>
      <!-- Rating -->
      <text x="${textX}" y="${textY}"
            font-family="${fontFamily}" font-size="${fontSize}"
            font-weight="bold" fill="white" text-anchor="middle">${ratingText}</text>`;
  }

  // Top-left: friend attribution (Friends Activity). `label` is already
  // sanitized, so it is safe inside the SVG.
  let friendBadge = '';
  if (label) {
    const friendFont = Math.round(badgeH * 0.42);
    const dotR = Math.round(badgeH * 0.14);
    const maxW = width - margin * 2;
    const textW = Math.min(
      Math.round(friendFont * label.length * 0.62),
      maxW - hPad * 3 - dotR * 2,
    );
    const badgeW = hPad + dotR * 2 + Math.round(hPad * 0.6) + textW + hPad;
    const badgeX = margin;
    const badgeY = margin;
    const cy = Math.round(badgeY + badgeH / 2);
    const textX = badgeX + hPad + dotR * 2 + Math.round(hPad * 0.6);
    const textY = cy + Math.round(friendFont * 0.36);
    friendBadge = `
      <rect x="${badgeX}" y="${badgeY}" width="${badgeW}" height="${badgeH}"
            rx="${rx}" ry="${rx}" fill="#1a1a1a" fill-opacity="0.92"/>
      <circle cx="${badgeX + hPad + dotR}" cy="${cy}" r="${dotR}" fill="#00C030"/>
      <text x="${textX}" y="${textY}"
            font-family="${fontFamily}" font-size="${friendFont}"
            font-weight="bold" fill="white">${label}</text>`;
  }

  const svgOverlay = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${ratingBadge}${friendBadge}
    </svg>`;

  const result = await image
    .composite([{ input: Buffer.from(svgOverlay), top: 0, left: 0 }])
    .jpeg({ quality: 75 })
    .toBuffer();

  posterCache.set(cacheKey, result);
  logger.debug({ posterUrl, rating, size: result.length }, 'Rated poster generated');

  return result;
}
