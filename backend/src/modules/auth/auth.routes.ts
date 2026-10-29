import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { loginBodySchema, preferencesBodySchema } from './auth.schemas.js';
import { loginUser, AuthenticationError } from './auth.service.js';
import { signUserToken } from '../../lib/jwt.js';
import { setSessionCookie, clearSessionCookie } from '../../lib/session-cookie.js';
import { sessionMiddleware } from '../../middleware/auth.middleware.js';
import { config } from '../../config/index.js';
import { ENTITLED_SESSION_TTL_SECONDS } from '../../lib/entitlement.js';
import { getEntitlement, getEntitlementStatus } from '../billing/billing.service.js';
import {
  getUserPreferences,
  revokeUserSessions,
  updateUserPreferences,
  upsertTier1User,
} from '../../db/repositories/user.repository.js';
import { fetchUserLists } from '../stremio/catalog/catalog-fetcher.service.js';
import { SessionExpiredError } from '../stremio/user-client.service.js';
import { trackEvent } from '../../lib/metrics.js';
import { callWithAppToken } from '../../lib/app-client.js';
import {
  fetchPageHtml,
  extractBoxdShortlinkId,
  extractListIdFromListPage,
} from '../../lib/html-scraper.js';
import { contributorNameCache, contributorCacheKey, CONTRIBUTOR_KIND_SHORT } from '../../lib/cache.js';
import { matchesSlug } from '../../lib/slug-match.js';
import { listIdFromSlug } from '../../lib/list-id.js';
import {
  searchMemberByUsername as rawSearchMemberByUsername,
  getMember as rawGetMember,
  getUserLists as rawGetUserLists,
  searchLists as rawSearchLists,
  getList as rawGetList,
  searchContributors as rawSearchContributors,
  LetterboxdApiError,
} from '../letterboxd/letterboxd.client.js';

async function resolveMemberByUsername(username: string) {
  const profileUrl = `https://letterboxd.com/${username}/`;
  const profileHtml = await fetchPageHtml(profileUrl);

  if (profileHtml) {
    const memberLid = extractBoxdShortlinkId(profileHtml);
    if (memberLid) {
      try {
        return await callWithAppToken((token) => rawGetMember(token, memberLid));
      } catch {
        // fallback to username search
      }
    }
  }

  return callWithAppToken((token) => rawSearchMemberByUsername(token, username));
}

export async function authRoutes(app: FastifyInstance) {
  app.post(
    '/auth/login',
    {
      config: { rateLimit: { max: 3, timeWindow: '1 minute' } },
      schema: {
        body: {
          type: 'object',
          properties: {
            username: { type: 'string' },
            password: { type: 'string' },
            totp: { type: 'string' },
            rememberMe: { type: 'boolean' },
          },
          required: ['username', 'password'],
        },
      },
    },
    async (
      request: FastifyRequest<{
        Body: { username: string; password: string; totp?: string; rememberMe?: boolean };
      }>,
      reply
    ) => {
      const body = loginBodySchema.safeParse(request.body);

      if (!body.success) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: body.error.issues,
        });
      }

      try {
        const result = await loginUser(
          body.data.username,
          body.data.password,
          body.data.totp,
          body.data.rememberMe
        );
        trackEvent('login', result.user?.id);

        const { _cookieToken, ...response } = result as typeof result & { _cookieToken: string };

        // Persisted (entitled + opted in) sessions get a persistent httpOnly
        // cookie; everyone else gets the raw token in the response body,
        // held only in frontend memory for the lifetime of the tab.
        if (result.persisted) {
          setSessionCookie(reply, _cookieToken, ENTITLED_SESSION_TTL_SECONDS);
        }

        return response;
      } catch (error) {
        if (error instanceof AuthenticationError) {
          const statusCode =
            error.code === '2FA_REQUIRED' ? 400
            : error.code === 'INVALID_CREDENTIALS' ? 401
            : 503;
          return reply.status(statusCode).send({
            error: error.message,
            code: error.code,
          });
        }
        throw error;
      }
    }
  );

  // Restores the configuration of a returning user from the session cookie,
  // so preferences already stored in the database never need a second login.
  app.get(
    '/auth/session',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      preHandler: sessionMiddleware,
    },
    async (request, reply) => {
      const user = request.sessionUser!;

      // Checked before the list-fetch round trip: a session is only cleared
      // when Polar confirmed the subscription is over (trustworthy), never
      // on a transient Polar outage.
      const fresh = (request.query as { fresh?: string }).fresh === '1';
      const { entitled, trustworthy } = await getEntitlementStatus(user.id, { fresh });

      if (!entitled) {
        if (trustworthy) {
          clearSessionCookie(reply);
        }
        return reply.status(401).send({ error: 'Subscription no longer active', code: 'NOT_ENTITLED' });
      }

      let lists;
      try {
        lists = await fetchUserLists(user);
      } catch (error) {
        // The stored Letterboxd refresh token is dead: only a new login can fix it.
        if (error instanceof SessionExpiredError) {
          clearSessionCookie(reply);
          return reply
            .status(401)
            .send({ error: 'Letterboxd session expired', code: 'SESSION_EXPIRED' });
        }
        throw error;
      }

      // Sliding expiration: an active subscriber never hits the token TTL.
      const refreshedToken = await signUserToken(
        {
          userId: user.id,
          letterboxdId: user.letterboxd_id,
          username: user.letterboxd_username,
        },
        ENTITLED_SESSION_TTL_SECONDS
      );
      setSessionCookie(reply, refreshedToken, ENTITLED_SESSION_TTL_SECONDS);

      return {
        manifestUrl: `${config.PUBLIC_URL}/stremio/${user.id}/manifest.json`,
        entitled: true,
        user: {
          id: user.id,
          username: user.letterboxd_username,
          displayName: user.letterboxd_display_name,
        },
        lists: lists.map((l) => ({
          id: l.id,
          name: l.name,
          filmCount: l.filmCount,
          ...(l.description ? { description: l.description } : {}),
        })),
        preferences: getUserPreferences(user),
      };
    }
  );

  app.post('/auth/logout', { preHandler: sessionMiddleware }, async (request, reply) => {
    // Revoke server-side too: clearing the cookie alone would leave a stolen
    // copy of the token usable until it expired on its own.
    revokeUserSessions(request.sessionUser!.id);
    clearSessionCookie(reply);
    return { success: true };
  });

  app.post(
    '/auth/preferences',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      preHandler: sessionMiddleware,
      schema: {
        body: {
          type: 'object',
          properties: {
            preferences: { type: 'object' },
          },
          required: ['preferences'],
        },
      },
    },
    async (
      request: FastifyRequest<{
        Body: { preferences: unknown };
      }>,
      reply
    ) => {
      const parsed = preferencesBodySchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: parsed.error.issues,
        });
      }

      updateUserPreferences(request.sessionUser!.id, parsed.data.preferences);

      return { success: true };
    }
  );

  // Lists the member liked on letterboxd.com, for the supporter-only picker in the
  // configuration UI. Read with the app token: likes are public, and the member's
  // own refresh token stays out of a browse-only call.
  app.get(
    '/auth/liked-lists',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      preHandler: sessionMiddleware,
    },
    async (request: FastifyRequest<{ Querystring: { cursor?: string } }>, reply) => {
      const user = request.sessionUser!;

      const { cursor } = request.query;
      if (cursor !== undefined && !/^start=\d{1,6}$/.test(cursor)) {
        return reply.status(400).send({ error: 'Invalid cursor' });
      }

      if (!(await getEntitlement(user.id))) {
        return reply.status(403).send({ error: 'Supporter feature', code: 'NOT_ENTITLED' });
      }

      const response = await callWithAppToken((token) =>
        rawSearchLists(token, {
          member: user.letterboxd_id,
          memberRelationship: 'Liked',
          perPage: 50,
          cursor,
        })
      );

      return {
        items: response.items.map((l) => ({
          id: l.id,
          name: l.name,
          owner: l.owner?.displayName || l.owner?.username || '',
          filmCount: l.filmCount,
        })),
        cursor: response.cursor,
      };
    }
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // Public endpoints (using app token, no user auth required)
  // ═══════════════════════════════════════════════════════════════════════════

  const validateUsernameSchema = z.object({
    username: z.string().min(1).max(15).regex(/^[a-zA-Z0-9_-]+$/),
  });

  app.post(
    '/auth/validate-username',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        body: {
          type: 'object',
          properties: { username: { type: 'string' } },
          required: ['username'],
        },
      },
    },
    async (
      request: FastifyRequest<{ Body: { username: string } }>,
      reply
    ) => {
      const parsed = validateUsernameSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Invalid username' });
      }

      try {
        const member = await resolveMemberByUsername(parsed.data.username);

        if (!member) {
          return { valid: false };
        }

        const tier1User = upsertTier1User(member.id, member.username, member.displayName);
        trackEvent('validate_username', tier1User.id, { found: true });

        // Fetch user's public lists
        const listsResponse = await callWithAppToken((token) =>
          rawGetUserLists(token, member.id, { perPage: 50 })
        );

        const lists = listsResponse.items.map((l) => ({
          id: l.id,
          name: l.name,
          filmCount: l.filmCount,
        }));

        return {
          valid: true,
          memberId: member.id,
          displayName: member.displayName || member.username,
          username: member.username,
          lists,
        };
      } catch {
        return reply.status(500).send({ error: 'Failed to validate username' });
      }
    }
  );

  const resolveListSchema = z.object({
    url: z.string().min(1).max(500),
  });

  // Top 250 list is available as a built-in catalog
  const TOP_250_LIST_ID = '8HjM';

  app.post(
    '/auth/resolve-list-public',
    {
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
      schema: {
        body: {
          type: 'object',
          properties: { url: { type: 'string' } },
          required: ['url'],
        },
      },
    },
    async (
      request: FastifyRequest<{ Body: { url: string } }>,
      reply
    ) => {
      const parsed = resolveListSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Invalid URL' });
      }

      // Validate it looks like a Letterboxd list URL
      const urlMatch = parsed.data.url.match(
        /(?:https?:\/\/)?(?:www\.)?letterboxd\.com\/([^/]+)\/list\/([^/]+)/
      );

      if (!urlMatch) {
        return reply.status(400).send({ error: 'Invalid Letterboxd list URL' });
      }

      try {
        // Strategy 1: Fetch public HTML page and extract boxd.it shortlink
        const normalizedUrl = parsed.data.url.startsWith('http')
          ? parsed.data.url
          : `https://${parsed.data.url}`;

        let parsedUrlObj: URL;
        try {
          parsedUrlObj = new URL(normalizedUrl);
        } catch {
          return reply.status(400).send({ error: 'Invalid URL' });
        }
        if (parsedUrlObj.hostname !== 'letterboxd.com' && parsedUrlObj.hostname !== 'www.letterboxd.com') {
          return reply.status(400).send({ error: 'Invalid Letterboxd list URL' });
        }

        const [, username, rawListSlug] = urlMatch;
        const listSlug = rawListSlug!.split(/[?#]/)[0]!.replace(/\/$/, '').toLowerCase();

        const slugListId = listIdFromSlug(listSlug);
        const pageHtml = slugListId ? null : await fetchPageHtml(normalizedUrl);

        if (slugListId || pageHtml) {
          const listId = slugListId ?? extractListIdFromListPage(pageHtml!);

          if (listId) {
            request.log.info({ listId, url: normalizedUrl }, 'Strategy 1: resolved list ID');
            try {
              const list = await callWithAppToken((token) =>
                rawGetList(token, listId)
              );

              // Block Top 250 list - already available as built-in catalog
              if (list.id === TOP_250_LIST_ID) {
                return reply.status(400).send({
                  error: 'This list is already available as a built-in catalog (Top 250 Narrative Features)',
                });
              }

              const ownerName = list.owner?.displayName || list.owner?.username || 'Unknown';

              return {
                id: list.id,
                name: list.name,
                owner: ownerName,
                filmCount: list.filmCount,
              };
            } catch (err) {
              // Lookup failed (404, private list, etc.) - fallback to strategy 2
              if (err instanceof LetterboxdApiError && err.status === 404) {
                request.log.warn({ listId }, 'Strategy 1: API returned 404 for extracted ID, falling back');
              } else {
                throw err; // Re-throw non-404 errors
              }
            }
          } else {
            request.log.warn({ url: normalizedUrl }, 'Strategy 1: no list ID found in HTML');
          }
        } else {
          request.log.warn({ url: normalizedUrl }, 'Strategy 1: failed to fetch HTML page');
        }

        // Strategy 2 (fallback): Resolve member → get all lists → match by words
        request.log.info({ username, listSlug }, 'Strategy 2: resolving member and fetching lists');

        const member = await resolveMemberByUsername(username!);
        if (!member) {
          return reply.status(404).send({ error: 'List not found' });
        }

        // Paginate through member's lists and match by word overlap
        let cursor: string | undefined;
        let page = 0;

        while (page < 5) {
          page++;
          const listsResponse = await callWithAppToken((token) =>
            rawSearchLists(token, { member: member.id, memberRelationship: 'Owner', perPage: 100, cursor })
          );

          const matched = listsResponse.items.find((l) => matchesSlug(l.name, listSlug));

          if (matched) {
            if (matched.id === TOP_250_LIST_ID) {
              return reply.status(400).send({
                error: 'This list is already available as a built-in catalog (Top 250 Narrative Features)',
              });
            }
            return {
              id: matched.id,
              name: matched.name,
              owner: matched.owner?.displayName || matched.owner?.username || member.displayName || member.username,
              filmCount: matched.filmCount,
            };
          }

          cursor = listsResponse.cursor;
          if (!cursor) break;
        }

        request.log.warn({ username, listSlug, memberId: member.id }, 'Strategy 2: no match found');
        return reply.status(404).send({ error: 'List not found' });
      } catch (err) {
        request.log.error({ err, url: parsed.data.url }, 'resolve-list-public failed');
        return reply.status(500).send({ error: 'Failed to resolve list' });
      }
    }
  );

  const resolveContributorSchema = z.object({
    url: z.string().min(1).max(500),
  });

  const CONTRIBUTOR_URL_REGEX =
    /(?:https?:\/\/)?(?:www\.)?letterboxd\.com\/(director|actor|studio)\/([^/?#]+)/i;

  const CONTRIBUTOR_KIND_TO_TYPE: Record<'director' | 'actor' | 'studio', 'Director' | 'Actor' | 'Studio'> = {
    director: 'Director',
    actor: 'Actor',
    studio: 'Studio',
  };

  app.post(
    '/auth/resolve-contributor-public',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        body: {
          type: 'object',
          properties: { url: { type: 'string' } },
          required: ['url'],
        },
      },
    },
    async (
      request: FastifyRequest<{ Body: { url: string } }>,
      reply
    ) => {
      const parsed = resolveContributorSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Invalid URL' });
      }

      const match = parsed.data.url.match(CONTRIBUTOR_URL_REGEX);
      if (!match) {
        return reply.status(400).send({
          error: 'URL must be a Letterboxd director, actor, or studio page',
        });
      }

      const kind = match[1]!.toLowerCase() as 'director' | 'actor' | 'studio';
      const slug = match[2]!.toLowerCase();
      const targetPath = `/${kind}/${slug}/`;

      try {
        const results = await callWithAppToken((token) =>
          rawSearchContributors(token, slug.replace(/-/g, ' '), { perPage: 20 })
        );

        const matched = results.items.find((c) =>
          c.links?.some((l) => l.type === 'letterboxd' && l.url.includes(targetPath))
        );

        if (!matched) {
          request.log.warn({ kind, slug }, 'resolve-contributor: no search result matched slug');
          return reply.status(404).send({ error: 'Could not resolve contributor ID' });
        }

        contributorNameCache.set(contributorCacheKey(CONTRIBUTOR_KIND_SHORT[kind], matched.id), matched.name);

        return {
          id: matched.id,
          name: matched.name,
          kind,
          type: CONTRIBUTOR_KIND_TO_TYPE[kind],
        };
      } catch (err) {
        request.log.error({ err, url: parsed.data.url }, 'resolve-contributor-public failed');
        return reply.status(500).send({ error: 'Failed to resolve contributor' });
      }
    }
  );
}
