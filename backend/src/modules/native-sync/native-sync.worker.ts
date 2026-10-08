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
  type NativeSyncJob,
} from '../../db/repositories/native-sync-job.repository.js';
import { getEntitlementStatus } from '../billing/billing.service.js';
import { createClientForUser, SessionExpiredError } from '../stremio/user-client.service.js';
import { findFilmByImdb } from '../stremio/meta.service.js';
import { LetterboxdApiError } from '../letterboxd/letterboxd.client.js';
import { invalidateUserCatalogs, userRatingCache } from '../../lib/cache.js';
import { trackEvent } from '../../lib/metrics.js';
import { createChildLogger } from '../../lib/logger.js';

const logger = createChildLogger('native-sync-worker');

export const TICK_MS = 2000;
const PURGE_EVERY_MS = 60 * 60 * 1000;
export const RETRY_DELAYS_MS = [60_000, 300_000, 1_800_000];

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
  if (err instanceof LetterboxdApiError) {
    if (err.status === 401 || err.status === 403) return new TerminalError('token_revoked');
    if (err.status === 404) return new TerminalError('film_not_found');
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

  const client = await createClientForUser(user);
  const film = await findFilmByImdb(client, job.imdbId);
  if (!film) throw new TerminalError('film_not_found');
  const filmId = film.letterboxdFilmId;

  if (job.kind === 'watch_flag') {
    if (hasDiaryJob(job.userId, job.imdbId, job.localDate)) return 'done';
    const relationship = await client.getFilmRelationship(filmId);
    if (!relationship.watched) await client.updateFilmRelationship(filmId, { watched: true });
    trackEvent('native_sync_flagged', job.userId);
  } else {
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
    const delay = RETRY_DELAYS_MS[job.attempts - 1];
    if (failure instanceof RetryableError && delay !== undefined) {
      scheduleRetry(job.id, new Date(now.getTime() + delay), failure.reason);
      logger.warn({ userId: job.userId, reason: failure.reason, attempt: job.attempts }, 'Native sync job will retry');
    } else {
      markFailed(job.id, failure.reason);
      trackEvent('native_sync_failed', job.userId, { reason: failure.reason });
      logger.warn({ userId: job.userId, reason: failure.reason }, 'Native sync job failed');
    }
  }
  return 'processed';
}

/** One job per tick so Native Sync never crowds out catalogue requests. Returns a stop function. */
export function startNativeSyncWorker(): () => void {
  const reset = resetStaleProcessing();
  if (reset > 0) logger.info({ reset }, 'Requeued native sync jobs interrupted by a restart');

  let running = false;
  const tick = setInterval(() => {
    if (running) return;
    running = true;
    processNextJob()
      .catch((err) => logger.error({ reason: err instanceof Error ? err.name : 'unknown' }, 'Native sync tick crashed'))
      .finally(() => {
        running = false;
      });
  }, TICK_MS);

  const purge = setInterval(() => {
    const purged = purgeJobs(new Date());
    if (purged > 0) logger.info({ purged }, 'Purged native sync jobs');
  }, PURGE_EVERY_MS);

  return () => {
    clearInterval(tick);
    clearInterval(purge);
  };
}
