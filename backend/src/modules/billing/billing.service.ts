import { createChildLogger } from '../../lib/logger.js';
import { refreshAccessToken, getCurrentUser } from '../letterboxd/letterboxd.client.js';
import { getDecryptedRefreshToken, updateUser, type User } from '../../db/repositories/user.repository.js';
import { isPolarConfigured } from '../../config/index.js';
import { createCheckout, createPortalUrl, getCustomerState } from '../../lib/polar.js';
import { isSupporter } from '../../lib/entitlement.js';
import { createCache } from '../../lib/cache.js';

const logger = createChildLogger('billing-service');

/**
 * Best-effort email lookup for checkout prefill. Never throws: any failure
 * (revoked token, network error, missing email on the profile, etc.) just
 * means checkout proceeds without a prefilled email.
 */
async function fetchEmailBestEffort(user: User): Promise<string | undefined> {
  try {
    const refreshToken = getDecryptedRefreshToken(user);
    const tokens = await refreshAccessToken(refreshToken);
    if (tokens.refresh_token !== refreshToken) {
      updateUser(user.id, {
        refreshToken: tokens.refresh_token,
        tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
      });
    }
    const profile = await getCurrentUser(tokens.access_token);
    return profile.emailAddress;
  } catch (err) {
    logger.warn(
      { userId: user.id, reason: err instanceof Error ? err.message : 'unknown' },
      'Could not fetch email for checkout prefill, continuing without it',
    );
    return undefined;
  }
}

// ─── Checkout ──────────────────────────────────────────────────────────────

export async function startCheckout(user: User): Promise<string> {
  const email = await fetchEmailBestEffort(user);
  return createCheckout({ userId: user.id, email });
}

// ─── Portal ────────────────────────────────────────────────────────────────

export function getPortalUrl(userId: string): Promise<string | null> {
  return createPortalUrl(userId);
}

// ─── Entitlement ───────────────────────────────────────────────────────────

const ENTITLEMENT_TTL_MS = 10 * 60 * 1000;
const MIN_POLAR_CALL_INTERVAL_MS = 5 * 1000;

interface EntitlementEntry {
  entitled: boolean;
  /** False when `entitled` is a degraded fallback (Polar failed), not a genuine answer. */
  trustworthy: boolean;
  /** Last successful Polar answer (0 if never). */
  fetchedAt: number;
  /** Last Polar call, successful or not — throttles polling and outages. */
  attemptedAt: number;
}

export interface EntitlementStatus {
  entitled: boolean;
  /**
   * False means `entitled: false` is not a confirmed "no" from Polar, just a
   * fallback after a failed lookup. Check this before a destructive action
   * (e.g. revoking a session); feature gates can ignore it.
   */
  trustworthy: boolean;
}

// ttl: 0 disables lru-cache expiry: freshness is checked by hand so the last
// known value is still available as a fallback when Polar is down.
const entitlementCache = createCache<EntitlementEntry>({ maxSize: 5000, ttl: 0 });

export function clearEntitlementCache(): void {
  entitlementCache.clear();
}

/** Use wherever a negative answer triggers a destructive action; see getEntitlement() for the simple case. */
export async function getEntitlementStatus(
  userId: string,
  options: { fresh?: boolean } = {}
): Promise<EntitlementStatus> {
  if (!isPolarConfigured) return { entitled: false, trustworthy: true };

  const now = Date.now();
  const entry = entitlementCache.get(userId);
  if (entry) {
    const recentlyAttempted = now - entry.attemptedAt < MIN_POLAR_CALL_INTERVAL_MS;
    const upToDate = now - entry.fetchedAt < ENTITLEMENT_TTL_MS;
    if (recentlyAttempted || (upToDate && !options.fresh)) {
      return { entitled: entry.entitled, trustworthy: entry.trustworthy };
    }
  }

  try {
    const entitled = isSupporter(await getCustomerState(userId));
    entitlementCache.set(userId, { entitled, trustworthy: true, fetchedAt: now, attemptedAt: now });
    return { entitled, trustworthy: true };
  } catch (err) {
    const entitled = entry?.entitled ?? false;
    logger.warn(
      { userId, reason: err instanceof Error ? err.message : 'unknown' },
      'Polar customer state lookup failed, using last known entitlement'
    );
    entitlementCache.set(userId, {
      entitled,
      trustworthy: false,
      fetchedAt: entry?.fetchedAt ?? 0,
      attemptedAt: now,
    });
    return { entitled, trustworthy: false };
  }
}

/** Simple boolean check for callers that just gate a feature (fail-closed is fine there). */
export async function getEntitlement(userId: string, options: { fresh?: boolean } = {}): Promise<boolean> {
  return (await getEntitlementStatus(userId, options)).entitled;
}
