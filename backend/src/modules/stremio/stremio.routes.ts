import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  findUserById,
  findUserByLetterboxdUsername,
  getUserPreferences,
} from '../../db/repositories/user.repository.js';
import {
  FilmRelationshipUpdate,
  getList as rawGetList,
  getMember as rawGetMember,
} from '../letterboxd/letterboxd.client.js';
import {
  generateManifest,
  generateDynamicManifest,
  generatePublicManifest,
} from './stremio.service.js';
import {
  buildLetterboxdStreams,
  findFilmByImdb,
  getRawCinemetaMeta,
  getFilmRatingData,
  getPopularReviewsText,
} from './meta.service.js';
import { generateRatedPoster } from './poster.service.js';
import { createChildLogger } from '../../lib/logger.js';
import {
  imdbToLetterboxdCache,
  listNameCache,
  contributorNameCache,
  contributorCacheKey,
  invalidateUserCatalogs,
} from '../../lib/cache.js';
import { trackEvent, type EventType } from '../../lib/metrics.js';
import { generateAnonId } from '../../lib/anonymous-id.js';
import { callWithAppToken } from '../../lib/app-client.js';
import { decodeConfig, type PublicConfig } from '../../lib/config-encoding.js';
import { serverConfig } from '../../config/index.js';
import { verifyAction } from '../../lib/action-sign.js';

// ─── Sub-modules ──────────────────────────────────────────────────────────────

import { handleCatalogRequest, fetchUserLists } from './catalog/catalog-fetcher.service.js';
import { handlePublicCatalogRequest, resolveMemberId, fetchPopularCatalogPublic, fetchTop250CatalogPublic } from './catalog/public-catalog-fetcher.service.js';
import { parseCombinedFilter, filterUnreleasedFilms } from './catalog/catalog-filter.js';
import { sendHtml, buildErrorPage, buildActionSuccessPage, buildRatingPage } from './action/action-html.js';
import { createClientForUser } from './user-client.service.js';

const logger = createChildLogger('stremio-routes');

// ─── Constants ────────────────────────────────────────────────────────────────

const CATALOG_EVENT_MAP: Record<string, EventType> = {
  'letterboxd-popular': 'catalog_popular',
  'letterboxd-top250': 'catalog_top250',
  'letterboxd-watchlist': 'catalog_watchlist',
};

function catalogIdToEvent(id: string): EventType {
  return CATALOG_EVENT_MAP[id] ?? (id.startsWith('letterboxd-list-') ? 'catalog_list' : 'catalog_popular');
}

/** Track a Tier 1 event — resolve user_id from DB if username known, else anonymous fallback */
function trackTier1(
  event: EventType,
  cfg: PublicConfig,
  request: FastifyRequest,
  extra?: Record<string, unknown>,
): void {
  const userId = cfg.u ? findUserByLetterboxdUsername(cfg.u)?.id : undefined;
  trackEvent(event, userId, { tier: 1, ...extra }, userId ? undefined : generateAnonId(request));
}

const IMDB_REGEX = /^tt\d{1,10}$/;

const actionParamsSchema = {
  type: 'object' as const,
  properties: {
    userId: { type: 'string' as const, pattern: '^[0-9a-f]{32}$' },
    action: { type: 'string' as const, enum: ['watched', 'liked', 'watchlist'] },
    filmId: { type: 'string' as const, pattern: '^[a-zA-Z0-9]+$' },
  },
  required: ['userId', 'action', 'filmId'] as const,
};

const rateParamsSchema = {
  type: 'object' as const,
  properties: {
    userId: { type: 'string' as const, pattern: '^[0-9a-f]{32}$' },
    filmId: { type: 'string' as const, pattern: '^[a-zA-Z0-9]+$' },
  },
  required: ['userId', 'filmId'] as const,
};

// ─── Tier 2: List/watchlist name resolvers ────────────────────────────────────

async function resolveListNames(listIds: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  await Promise.all(
    listIds.map(async (id) => {
      const cached = listNameCache.get(id);
      if (cached) { names.set(id, cached); return; }
      try {
        const list = await callWithAppToken((token) => rawGetList(token, id));
        listNameCache.set(id, list.name);
        names.set(id, list.name);
      } catch {
        // Fallback: keep ID as name
      }
    }),
  );
  return names;
}

function resolveContributorNames(
  entries: Array<{ t: 'd' | 'a' | 's'; id: string }>,
): Map<string, string> {
  const names = new Map<string, string>();
  for (const entry of entries) {
    const key = contributorCacheKey(entry.t, entry.id);
    names.set(key, contributorNameCache.get(key) ?? `Contributor ${entry.id}`);
  }
  return names;
}

// ─── Route registration ───────────────────────────────────────────────────────

export async function stremioRoutes(app: FastifyInstance) {

  // ═══════════════════════════════════════════════════════════════════════════
  // Poster Proxy: Rating badge overlay on poster images
  // ═══════════════════════════════════════════════════════════════════════════

  app.get(
    '/poster',
    { config: { rateLimit: false } },
    async (
      request: FastifyRequest<{ Querystring: { url?: string; rating?: string } }>,
      reply,
    ) => {
      const { url, rating: ratingStr } = request.query;

      if (!url || !ratingStr) {
        return reply.status(400).send({ error: 'Missing url or rating parameter' });
      }

      const rating = parseFloat(ratingStr);
      if (isNaN(rating) || rating < 0 || rating > 5) {
        return reply.status(400).send({ error: 'Rating must be between 0 and 5' });
      }

      try {
        const parsed = new URL(url);
        if (!parsed.hostname.endsWith('.ltrbxd.com') && !parsed.hostname.endsWith('.letterboxd.com')) {
          return reply.status(400).send({ error: 'Invalid poster URL' });
        }
      } catch {
        return reply.status(400).send({ error: 'Invalid URL' });
      }

      try {
        const imageBuffer = await generateRatedPoster(url, rating);
        return reply
          .header('Content-Type', 'image/jpeg')
          .header('Cache-Control', 'public, max-age=3600')
          .send(imageBuffer);
      } catch (error) {
        logger.error({ error, url, rating }, 'Failed to generate rated poster');
        return reply.status(500).send({ error: 'Failed to generate poster' });
      }
    },
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // Tier 1: Generic public catalogs (Popular + Top 250)
  // ═══════════════════════════════════════════════════════════════════════════

  app.get('/catalog/movie/letterboxd-popular.json', async (_request, reply) => {
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Content-Type', 'application/json');
    return await fetchPopularCatalogPublic(0, true);
  });

  app.get(
    '/catalog/movie/letterboxd-popular/:extra.json',
    async (request: FastifyRequest<{ Params: { extra: string } }>, reply) => {
      reply.header('Access-Control-Allow-Origin', '*');
      reply.header('Content-Type', 'application/json');
      const { skip, sort, isShuffle, isReleasedOnly, includeGenre, decade } = parseCombinedFilter(request.params.extra);
      const effectiveSort = isShuffle ? 'Shuffle' : sort;
      const { metas } = await fetchPopularCatalogPublic(skip, true, effectiveSort, includeGenre, decade);
      return { metas: filterUnreleasedFilms(metas, isReleasedOnly) };
    },
  );

  app.get('/catalog/movie/letterboxd-top250.json', async (_request, reply) => {
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Content-Type', 'application/json');
    return await fetchTop250CatalogPublic(0, true);
  });

  app.get(
    '/catalog/movie/letterboxd-top250/:extra.json',
    async (request: FastifyRequest<{ Params: { extra: string } }>, reply) => {
      reply.header('Access-Control-Allow-Origin', '*');
      reply.header('Content-Type', 'application/json');
      const { skip, sort, isShuffle, isReleasedOnly, includeGenre, decade } = parseCombinedFilter(request.params.extra);
      const effectiveSort = isShuffle ? 'Shuffle' : sort;
      const { metas } = await fetchTop250CatalogPublic(skip, true, effectiveSort, includeGenre, decade);
      return { metas: filterUnreleasedFilms(metas, isReleasedOnly) };
    },
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // Tier 2: Config-based public routes
  // ═══════════════════════════════════════════════════════════════════════════

  app.get(
    '/:config/manifest.json',
    async (request: FastifyRequest<{ Params: { config: string } }>, reply) => {
      const cfg = decodeConfig(request.params.config);
      if (!cfg) return reply.status(400).send({ error: 'Invalid config' });

      trackTier1('manifest_view', cfg, request);
      reply.header('Access-Control-Allow-Origin', '*');
      reply.header('Content-Type', 'application/json');
      reply.header('Cache-Control', 'public, max-age=3600');

      let displayName: string | undefined;
      if (cfg.u) {
        try {
          const member = await callWithAppToken((token) => rawGetMember(token, cfg.u!));
          displayName = member.displayName || member.username;
        } catch {
          displayName = cfg.u;
        }
      }

      const listNames = cfg.l.length > 0 ? await resolveListNames(cfg.l) : undefined;
      const contributorNames = cfg.f?.length ? resolveContributorNames(cfg.f) : undefined;

      let watchlistNames: Map<string, string> | undefined;
      if (cfg.w && cfg.w.length > 0) {
        watchlistNames = new Map<string, string>();
        await Promise.all(
          cfg.w.map(async (username) => {
            try {
              const member = await callWithAppToken((token) => rawGetMember(token, username));
              watchlistNames!.set(username, member.displayName || member.username);
            } catch {
              watchlistNames!.set(username, username);
            }
          }),
        );
      }

      return generatePublicManifest(cfg, displayName, listNames, watchlistNames, contributorNames);
    },
  );

  app.get(
    '/:config/catalog/movie/:id.json',
    async (request: FastifyRequest<{ Params: { config: string; id: string } }>, reply) => {
      const cfg = decodeConfig(request.params.config);
      if (!cfg) return reply.status(400).send({ error: 'Invalid config' });

      trackTier1(catalogIdToEvent(request.params.id), cfg, request, { catalog: request.params.id });
      reply.header('Access-Control-Allow-Origin', '*');
      reply.header('Content-Type', 'application/json');

      const memberId = cfg.u ? await resolveMemberId(cfg.u) : null;
      return await handlePublicCatalogRequest(cfg, request.params.id, undefined, memberId);
    },
  );

  app.get(
    '/:config/catalog/movie/:id/:extra.json',
    async (request: FastifyRequest<{ Params: { config: string; id: string; extra: string } }>, reply) => {
      const cfg = decodeConfig(request.params.config);
      if (!cfg) return reply.status(400).send({ error: 'Invalid config' });

      trackTier1(catalogIdToEvent(request.params.id), cfg, request, { catalog: request.params.id });
      reply.header('Access-Control-Allow-Origin', '*');
      reply.header('Content-Type', 'application/json');

      const memberId = cfg.u ? await resolveMemberId(cfg.u) : null;
      return await handlePublicCatalogRequest(cfg, request.params.id, request.params.extra, memberId);
    },
  );

  // Meta Route: Tier 2 — pass-through Cinemeta (no auth required)
  app.get(
    '/:config/meta/movie/:imdbId.json',
    async (request: FastifyRequest<{ Params: { config: string; imdbId: string } }>, reply) => {
      const { imdbId } = request.params;
      if (!IMDB_REGEX.test(imdbId)) return reply.status(400).send({ error: 'Invalid IMDb ID' });

      const cfg = decodeConfig(request.params.config);
      if (!cfg) return reply.status(400).send({ error: 'Invalid config' });

      reply.header('Access-Control-Allow-Origin', '*');
      reply.header('Content-Type', 'application/json');
      reply.header('Cache-Control', 'public, max-age=3600');

      const rawMeta = await getRawCinemetaMeta(imdbId);
      if (!rawMeta) return { meta: null };

      const meta: Record<string, unknown> = { ...rawMeta };
      meta['behaviorHints'] = {
        ...(meta['behaviorHints'] as Record<string, unknown> || {}),
        defaultVideoId: imdbId,
      };

      const letterboxdId = imdbToLetterboxdCache.get(imdbId);
      if (letterboxdId) {
        const existingLinks = (meta['links'] as Array<Record<string, string>>) || [];
        existingLinks.push({
          name: 'Letterboxd',
          category: 'Letterboxd',
          url: `https://letterboxd.com/film/${letterboxdId}/`,
        });
        meta['links'] = existingLinks;
      }

      return { meta };
    },
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // Tier 3: User-authenticated routes
  // ═══════════════════════════════════════════════════════════════════════════

  app.get(
    '/stremio/:userId/manifest.json',
    async (request: FastifyRequest<{ Params: { userId: string } }>, reply) => {
      const { userId } = request.params;
      const user = findUserById(userId);
      if (!user) {
        logger.warn({ userId }, 'User not found for manifest');
        return reply.status(404).send({ error: 'User not found' });
      }

      reply.header('Access-Control-Allow-Origin', '*');
      reply.header('Content-Type', 'application/json');

      try {
        const lists = await fetchUserLists(user);
        const preferences = getUserPreferences(user);
        const manifest = generateDynamicManifest(
          { username: user.letterboxd_username, displayName: user.letterboxd_display_name },
          lists,
          preferences,
        );
        trackEvent('install', userId);
        logger.info(
          { username: user.letterboxd_username, listsCount: lists.length, hasPreferences: !!preferences },
          'Dynamic manifest generated',
        );
        return manifest;
      } catch (error) {
        logger.error({ error, userId }, 'Failed to fetch user lists, using static manifest');
        return generateManifest({
          username: user.letterboxd_username,
          displayName: user.letterboxd_display_name,
        });
      }
    },
  );

  app.get(
    '/stremio/:userId/catalog/:type/:id.json',
    async (request: FastifyRequest<{ Params: { userId: string; type: string; id: string } }>, reply) => {
      const { userId, type, id } = request.params;
      reply.header('Access-Control-Allow-Origin', '*');
      reply.header('Content-Type', 'application/json');
      try {
        return await handleCatalogRequest(userId, type, id);
      } catch {
        return reply.status(404).send({ error: 'User not found' });
      }
    },
  );

  app.get(
    '/stremio/:userId/catalog/:type/:id/:extra.json',
    async (
      request: FastifyRequest<{ Params: { userId: string; type: string; id: string; extra: string } }>,
      reply,
    ) => {
      const { userId, type, id, extra } = request.params;
      reply.header('Access-Control-Allow-Origin', '*');
      reply.header('Content-Type', 'application/json');
      try {
        return await handleCatalogRequest(userId, type, id, extra);
      } catch {
        return reply.status(404).send({ error: 'User not found' });
      }
    },
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // Stream Route: Letterboxd info & actions as streams
  // ═══════════════════════════════════════════════════════════════════════════

  app.get(
    '/stremio/:userId/stream/:type/:id.json',
    async (
      request: FastifyRequest<{ Params: { userId: string; type: string; id: string } }>,
      reply,
    ) => {
      const { userId, type, id } = request.params;
      const user = findUserById(userId);
      if (!user) return reply.status(404).send({ streams: [] });

      logger.info({ type, id, username: user.letterboxd_username }, 'Stream request');
      reply.header('Access-Control-Allow-Origin', '*');
      reply.header('Content-Type', 'application/json');

      if (type !== 'movie') return { streams: [] };

      const imdbId = id.replace(/\.json$/, '');
      try {
        trackEvent('stream', userId, { imdbId });
        const client = await createClientForUser(user);
        const preferences = getUserPreferences(user);
        const showActions = preferences?.showActions !== false;
        const streams = await buildLetterboxdStreams(client, imdbId, user.id, showActions);
        logger.info({ imdbId, streamCount: streams.length }, 'Letterboxd streams returned');
        return { streams };
      } catch (error) {
        logger.error({ error, userId, imdbId }, 'Failed to fetch streams');
        return { streams: [] };
      }
    },
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // Meta Route: Pass-through Cinemeta + Letterboxd poster badge (Tier 3)
  // ═══════════════════════════════════════════════════════════════════════════

  app.get(
    '/stremio/:userId/meta/movie/:imdbId.json',
    async (request: FastifyRequest<{ Params: { userId: string; imdbId: string } }>, reply) => {
      const { userId, imdbId } = request.params;
      if (!IMDB_REGEX.test(imdbId)) return reply.status(400).send({ error: 'Invalid IMDb ID' });

      const user = findUserById(userId);
      if (!user) return reply.status(404).send({ meta: null });

      reply.header('Access-Control-Allow-Origin', '*');
      reply.header('Content-Type', 'application/json');

      const rawMeta = await getRawCinemetaMeta(imdbId);
      if (!rawMeta) return { meta: null };

      const meta: Record<string, unknown> = { ...rawMeta };
      try {
        const client = await createClientForUser(user);
        const letterboxdResult = await findFilmByImdb(client, imdbId);
        if (letterboxdResult) {
          const { letterboxdFilmId } = letterboxdResult;

          // Poster badge (non-critical)
          const metaPreferences = getUserPreferences(user);
          const showRatings = metaPreferences?.showRatings !== false;
          try {
            if (showRatings) {
              const ratingData = await getFilmRatingData(client, letterboxdFilmId);
              if (ratingData.communityRating !== null && rawMeta['poster']) {
                meta['poster'] = `${serverConfig.publicUrl}/poster?url=${encodeURIComponent(rawMeta['poster'] as string)}&rating=${ratingData.communityRating.toFixed(1)}`;
              }
            }
          } catch {
            // Rating lookup failed — skip badge
          }

          // Letterboxd film page link
          const existingLinks = (meta['links'] as Array<{ name: string; category: string; url: string }>) || [];
          existingLinks.push({
            name: 'Letterboxd',
            category: 'Letterboxd',
            url: `https://letterboxd.com/film/${letterboxdFilmId}/`,
          });
          meta['links'] = existingLinks;

          // Popular reviews
          const showReviews = metaPreferences?.showReviews !== false;
          if (showReviews) {
            try {
              const reviewsText = await getPopularReviewsText(client, letterboxdFilmId);
              if (reviewsText) {
                const letterboxdUrl = `https://letterboxd.com/film/${letterboxdFilmId}/reviews/`;
                const reviewLinks = reviewsText.split('\n\n').map((line) => ({
                  name: line,
                  category: 'Letterboxd Popular Reviews',
                  url: letterboxdUrl,
                }));
                meta['links'] = [...(meta['links'] as Array<Record<string, string>>), ...reviewLinks];
              }
            } catch {
              // Reviews fetch failed — skip
            }
          }
        }
      } catch {
        // Non-critical — fall through to raw Cinemeta response
      }

      meta['behaviorHints'] = {
        ...(meta['behaviorHints'] as Record<string, unknown> || {}),
        defaultVideoId: imdbId,
      };

      return { meta };
    },
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // Action Routes: Toggle watched/liked/watchlist on Letterboxd
  // ═══════════════════════════════════════════════════════════════════════════

  app.get(
    '/action/:userId/:action/:filmId',
    { schema: { params: actionParamsSchema } },
    async (
      request: FastifyRequest<{
        Params: { userId: string; action: string; filmId: string };
        Querystring: { set?: string; imdb?: string; tok?: string };
      }>,
      reply,
    ) => {
      const { userId, action, filmId } = request.params;
      const tok = request.query.tok;

      if (!tok || !verifyAction(userId, filmId, action, tok)) {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      const setValue = request.query.set === 'true';
      const rawImdbId = request.query.imdb;
      const imdbId = rawImdbId && IMDB_REGEX.test(rawImdbId) ? rawImdbId : undefined;

      const user = findUserById(userId);
      if (!user) {
        return sendHtml(reply, buildErrorPage('User not found', 'Please re-install the addon.'), 404);
      }

      logger.info({ userId, action, filmId, setValue, imdbId }, 'Action request');

      try {
        const actionEventMap: Record<string, 'action_watched' | 'action_liked' | 'action_watchlist'> = {
          watched: 'action_watched',
          liked: 'action_liked',
          watchlist: 'action_watchlist',
        };
        const eventType = actionEventMap[action];
        if (eventType) trackEvent(eventType, userId, { filmId, setValue, ...(imdbId && { imdbId }) });

        const client = await createClientForUser(user);

        const update: FilmRelationshipUpdate = {};
        if (action === 'watched') update.watched = setValue;
        if (action === 'liked') update.liked = setValue;
        if (action === 'watchlist') update.inWatchlist = setValue;

        const result = await client.updateFilmRelationship(filmId, update);
        invalidateUserCatalogs(userId);

        const actionLabels: Record<string, { active: string; inactive: string }> = {
          watched: { active: 'Marked as watched', inactive: 'Removed from watched' },
          liked: { active: 'Liked', inactive: 'Unliked' },
          watchlist: { active: 'Added to watchlist', inactive: 'Removed from watchlist' },
        };
        const label = actionLabels[action]!;
        const message = setValue ? label.active : label.inactive;
        const stremioDeepLink = imdbId ? `stremio:///detail/movie/${imdbId}` : null;

        const statusParts: string[] = [];
        if (result.data.watched) statusParts.push('Watched');
        if (result.data.liked) statusParts.push('Liked');
        if (result.data.inWatchlist) statusParts.push('In Watchlist');
        const statusLine = statusParts.join(' · ');

        return sendHtml(
          reply,
          buildActionSuccessPage({ message, statusLine: statusLine || undefined, stremioDeepLink }),
        );
      } catch (error) {
        logger.error({ error, userId, action, filmId }, 'Failed to perform action');
        return sendHtml(reply, buildErrorPage('Action failed', 'Could not update Letterboxd. Please try again.'), 500);
      }
    },
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // Rating Page: Show rating selection UI
  // ═══════════════════════════════════════════════════════════════════════════

  app.get(
    '/action/:userId/rate/:filmId',
    { schema: { params: rateParamsSchema } },
    async (
      request: FastifyRequest<{
        Params: { userId: string; filmId: string };
        Querystring: { imdb?: string; current?: string; name?: string; tok?: string };
      }>,
      reply,
    ) => {
      const { userId, filmId } = request.params;
      const tok = request.query.tok;

      if (!tok || !verifyAction(userId, filmId, 'rate', tok)) {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      const rawImdbId = request.query.imdb;
      const imdbId = rawImdbId && IMDB_REGEX.test(rawImdbId) ? rawImdbId : undefined;
      const currentRating = request.query.current ? parseFloat(request.query.current) : null;
      const filmName = request.query.name || 'this film';

      const user = findUserById(userId);
      if (!user) {
        return sendHtml(reply, buildErrorPage('User not found'), 404);
      }

      const safeFilmName = filmName
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

      const submitBase = `/action/${userId}/rate/${filmId}/submit?imdb=${imdbId || ''}&tok=${tok}&rating=`;
      const stremioDeepLink = imdbId ? `stremio:///detail/movie/${imdbId}` : null;

      return sendHtml(
        reply,
        buildRatingPage({ safeFilmName, submitBase, currentRating, stremioDeepLink }),
      );
    },
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // Rating Submit: Actually submit the rating
  // ═══════════════════════════════════════════════════════════════════════════

  app.get(
    '/action/:userId/rate/:filmId/submit',
    { schema: { params: rateParamsSchema } },
    async (
      request: FastifyRequest<{
        Params: { userId: string; filmId: string };
        Querystring: { rating: string; imdb?: string; tok?: string };
      }>,
      reply,
    ) => {
      const { userId, filmId } = request.params;
      const tok = request.query.tok;

      if (!tok || !verifyAction(userId, filmId, 'rate', tok)) {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      const { rating: ratingStr } = request.query;
      const rawImdbId = request.query.imdb;
      const imdbId = rawImdbId && IMDB_REGEX.test(rawImdbId) ? rawImdbId : undefined;

      const user = findUserById(userId);
      if (!user) {
        return sendHtml(reply, buildErrorPage('User not found'), 404);
      }

      const isRemove = ratingStr === 'remove';
      const rating = isRemove ? null : parseFloat(ratingStr);

      logger.info({ userId, filmId, rating, isRemove, imdbId }, 'Rating submit request');
      trackEvent('action_rate', userId, { filmId, rating, isRemove, ...(imdbId && { imdbId }) });

      try {
        const client = await createClientForUser(user);
        const update: FilmRelationshipUpdate = { rating: isRemove ? null : rating };
        await client.updateFilmRelationship(filmId, update);
        invalidateUserCatalogs(userId);

        const message = isRemove ? 'Rating removed' : `Rated &#9733; ${rating!.toFixed(1)}`;
        const stremioDeepLink = imdbId ? `stremio:///detail/movie/${imdbId}` : null;

        return sendHtml(reply, buildActionSuccessPage({ message, stremioDeepLink }));
      } catch (error) {
        logger.error({ error, userId, filmId, rating }, 'Failed to submit rating');
        return sendHtml(reply, buildErrorPage('Rating failed', 'Could not update Letterboxd. Please try again.'), 500);
      }
    },
  );
}
