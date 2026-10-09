import { findUserById, getUserPreferences } from '../../db/repositories/user.repository.js';
import {
  claimNextJob,
  deleteJob,
  hasDiaryJob,
  markDone,
  markFailed,
  purgeJobs,
  resetStaleProcessing,
  scheduleRetry,
  scheduleRetryKeepingAttempts,
  type NativeSyncJob,
} from '../../db/repositories/native-sync-job.repository.js';
import { getEntitlementStatus } from '../billing/billing.service.js';
import { createClientForUser, SessionExpiredError } from '../stremio/user-client.service.js';
import { resolveFilmForWrite, ResolverUnavailableError } from './film-resolver.js';
import { LetterboxdApiError } from '../letterboxd/letterboxd.client.js';
import { invalidateUserCatalogs, userRatingCache } from '../../lib/cache.js';
import { trackEvent } from '../../lib/metrics.js';
import { createChildLogger } from '../../lib/logger.js';

const logger = createChildLogger('native-sync-worker');

export const TICK_MS = 2000;
const STOP_WAIT_MS = 10_000;
const PURGE_EVERY_MS = 60 * 60 * 1000;
export const RETRY_DELAYS_MS = [60_000, 300_000, 1_800_000];
const ENTITLEMENT_RETRY_MS = 30 * 60 * 1000;
const ENTITLEMENT_GIVE_UP_MS = 24 * 60 * 60 * 1000;

class TerminalError extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}
class RetryableError extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

function classify(err: unknown): TerminalError | RetryableError {
  if (err instanceof TerminalError || err instanceof RetryableError) return err;
  if (err instanceof SessionExpiredError) return new TerminalError('token_revoked');
  if (err instanceof ResolverUnavailableError) return new RetryableError('resolver_unavailable');
  if (err instanceof LetterboxdApiError) {
    if (err.status === 401) return new TerminalError('token_revoked');
    if (err.status === 403) return new TerminalError('forbidden');
    // Any other client error will fail the same way again; film_not_found is decided at resolution only.
    if (err.status >= 400 && err.status < 500 && err.status !== 429) return new TerminalError('rejected');
  }
  return new RetryableError('upstream_error');
}

async function runJob(job: NativeSyncJob): Promise<'done' | 'dropped'> {
  const user = findUserById(job.userId);
  if (!user?.encrypted_refresh_token) return 'dropped';
  if (getUserPreferences(user)?.nativeSync !== true) return 'dropped';

  const entitlement = await getEntitlementStatus(job.userId);
  if (!entitlement.entitled) {
    if (entitlement.trustworthy) return 'dropped';
    throw new RetryableError('entitlement_unavailable');
  }

  if (job.kind === 'watch_flag' && hasDiaryJob(job.userId, job.imdbId, job.localDate)) return 'done';

  const client = await createClientForUser(user);
  let film: { letterboxdFilmId: string } | null;
  try {
    film = await resolveFilmForWrite(client, job.imdbId);
  } catch (err) {
    if (err instanceof LetterboxdApiError && err.status === 404) throw new TerminalError('film_not_found');
    throw err;
  }
  if (!film) throw new TerminalError('film_not_found');
  const filmId = film.letterboxdFilmId;

  if (job.kind === 'watch_flag') {
    const relationship = await client.getFilmRelationship(filmId);
    if (!relationship.watched) await client.updateFilmRelationship(filmId, { watched: true });
    trackEvent('native_sync_flagged', job.userId);
  } else {
    // The member may have logged it by hand, or a previous attempt may have written before failing
    // to report back: never log the same film twice on the same day.
    const recent = await client.getMemberLogEntries({ perPage: 20 });
    if (recent.items.some((e) => e.film.id === filmId && e.diaryDetails?.diaryDate === job.localDate)) return 'done';
    const relationship = await client.getFilmRelationship(filmId);
    await client.createDiaryEntry({ filmId, diaryDate: job.localDate, rewatch: relationship.watched });
    trackEvent('native_sync_logged', job.userId);
  }

  userRatingCache.delete(`rating:${job.userId}:${filmId}`);
  invalidateUserCatalogs(job.userId);
  return 'done';
}

export async function processNextJob(now: Date = new Date()): Promise<'idle' | 'processed'> {
  const job = claimNextJob(now);
  if (!job) return 'idle';

  try {
    const outcome = await runJob(job);
    if (outcome === 'dropped') deleteJob(job.id);
    else markDone(job.id);
    logger.info({ userId: job.userId, outcome }, 'Native sync job finished');
  } catch (err) {
    const failure = classify(err);
    const outage = failure instanceof RetryableError && failure.reason === 'entitlement_unavailable';
    let delay: number | undefined;
    if (failure instanceof RetryableError) {
      if (outage) {
        // A billing outage must not cost a paying member their watch, nor their retry budget: keep trying for a day.
        const age = now.getTime() - new Date(job.occurredAt).getTime();
        delay = age <= ENTITLEMENT_GIVE_UP_MS ? ENTITLEMENT_RETRY_MS : undefined;
      } else {
        delay = RETRY_DELAYS_MS[job.attempts - 1];
      }
    }
    if (failure instanceof RetryableError && delay !== undefined) {
      const at = new Date(now.getTime() + delay);
      if (outage) scheduleRetryKeepingAttempts(job.id, at, failure.reason);
      else scheduleRetry(job.id, at, failure.reason);
      logger.warn({ userId: job.userId, reason: failure.reason, attempt: job.attempts }, 'Native sync job will retry');
    } else {
      markFailed(job.id, failure.reason);
      trackEvent('native_sync_failed', job.userId, { reason: failure.reason });
      logger.warn({ userId: job.userId, reason: failure.reason }, 'Native sync job failed');
    }
  }
  return 'processed';
}

/**
 * One job per tick so Native Sync never crowds out catalogue requests.
 * Returns a stop function whose promise settles once any in-flight job has finished.
 */
export function startNativeSyncWorker(): (timeoutMs?: number) => Promise<void> {
  const reset = resetStaleProcessing();
  if (reset > 0) logger.info({ reset }, 'Requeued native sync jobs interrupted by a restart');

  const runPurge = () => {
    const purged = purgeJobs(new Date());
    if (purged > 0) logger.info({ purged }, 'Purged native sync jobs');
  };
  runPurge();

  let inflight: Promise<unknown> | null = null;
  const tick = setInterval(() => {
    if (inflight) return;
    inflight = processNextJob()
      .catch((err) => logger.error({ reason: err instanceof Error ? err.name : 'unknown' }, 'Native sync tick crashed'))
      .finally(() => {
        inflight = null;
      });
  }, TICK_MS);

  const purge = setInterval(runPurge, PURGE_EVERY_MS);

  return async (timeoutMs = STOP_WAIT_MS) => {
    clearInterval(tick);
    clearInterval(purge);
    if (!inflight) return;
    let timer: NodeJS.Timeout | undefined;
    const bound = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
      timer.unref();
    });
    try {
      await Promise.race([inflight, bound]);
    } finally {
      clearTimeout(timer);
    }
  };
}
