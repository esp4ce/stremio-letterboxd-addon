import {
  AuthenticatedClient,
  createAuthenticatedClient,
  refreshAccessToken,
  LetterboxdApiError,
} from '../letterboxd/letterboxd.client.js';
import { getDecryptedRefreshToken, updateUser, User } from '../../db/repositories/user.repository.js';
import { userClientCache, watchedImdbCache, cacheMetrics } from '../../lib/cache.js';
import { throttled } from '../../lib/retry.js';
import { createChildLogger } from '../../lib/logger.js';
import { getImdbId } from './catalog.service.js';

export class SessionExpiredError extends Error {
  constructor(userId: string) {
    super(`Session expired for user ${userId}`);
    this.name = 'SessionExpiredError';
  }
}

const logger = createChildLogger('user-client-service');

// ─── Authenticated client factory (with LRU token cache) ─────────────────────

/**
 * Create authenticated Letterboxd client for a user.
 * Reuses a cached token if still valid (60s margin), otherwise refreshes.
 * All calls are throttled to respect rate limits.
 */
export async function createClientForUser(user: User): Promise<AuthenticatedClient> {
  // Check cached client — reuse if token still valid (60s margin)
  const cached = userClientCache.get(user.id);
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    cacheMetrics.tokenHits++;
    logger.debug({ userId: user.id }, 'Token cache hit');
    return cached.client;
  }
  cacheMetrics.tokenMisses++;

  const refreshToken = getDecryptedRefreshToken(user);
  let tokens;
  try {
    tokens = await refreshAccessToken(refreshToken);
  } catch (err) {
    if (
      err instanceof LetterboxdApiError &&
      (err.status === 400 || err.status === 401) &&
      typeof err.body === 'object' &&
      err.body !== null &&
      (err.body as Record<string, unknown>)['error'] === 'invalid_grant'
    ) {
      logger.warn({ userId: user.id }, 'Refresh token invalid — session expired');
      throw new SessionExpiredError(user.id);
    }
    throw err;
  }

  // Update stored refresh token if it changed
  if (tokens.refresh_token !== refreshToken) {
    updateUser(user.id, {
      refreshToken: tokens.refresh_token,
      tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    });
  }

  const expiresAt = Date.now() + tokens.expires_in * 1000;

  const client = createAuthenticatedClient(
    tokens.access_token,
    tokens.refresh_token,
    user.letterboxd_id,
    (newTokens) => {
      updateUser(user.id, {
        refreshToken: newTokens.refresh_token,
        tokenExpiresAt: new Date(Date.now() + newTokens.expires_in * 1000),
      });
      // Update cache with new expiry on token refresh
      userClientCache.set(user.id, {
        client,
        expiresAt: Date.now() + newTokens.expires_in * 1000,
      });
    },
  );

  userClientCache.set(user.id, { client, expiresAt });
  logger.debug({ userId: user.id }, 'Token cache miss — refreshed');

  return new Proxy(client, {
    get(target, prop) {
      const val = target[prop as keyof AuthenticatedClient];
      if (typeof val !== 'function') return val;
      return (...args: unknown[]) =>
        throttled(() => (val as (...a: unknown[]) => Promise<unknown>).apply(target, args));
    },
  });
}

// ─── Watched IMDb IDs (cached 5 min) ─────────────────────────────────────────

/**
 * Get the set of IMDb IDs the user has watched (cached 5 min).
 */
export async function getWatchedImdbIds(user: User): Promise<Set<string>> {
  const cached = watchedImdbCache.get(user.id);
  if (cached) return cached.ids;

  const client = await createClientForUser(user);
  const ids = new Set<string>();
  let cursor: string | undefined;
  let page = 0;

  do {
    page++;
    const watched = await client.getFilms({
      member: user.letterboxd_id,
      memberRelationship: 'Watched',
      perPage: 100,
      cursor,
    });
    for (const film of watched.items) {
      const imdb = getImdbId(film);
      if (imdb) ids.add(imdb);
    }
    cursor = watched.cursor;
  } while (cursor && page < 10);

  watchedImdbCache.set(user.id, { ids });
  logger.debug({ userId: user.id, count: ids.size }, 'Watched IMDb IDs cached');
  return ids;
}
