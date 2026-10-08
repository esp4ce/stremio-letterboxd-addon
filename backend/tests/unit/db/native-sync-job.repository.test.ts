import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initDb, closeDb, getDb } from '../../../src/db/index.js';
import { createUser } from '../../../src/db/repositories/user.repository.js';
import {
  enqueueJob,
  claimNextJob,
  markDone,
  markFailed,
  scheduleRetry,
  scheduleRetryKeepingAttempts,
  hasDiaryJob,
  hasRecentDiaryJob,
  countDiaryJobsForDay,
  purgeJobs,
  resetStaleProcessing,
} from '../../../src/db/repositories/native-sync-job.repository.js';

const T0 = new Date('2026-10-08T12:00:00.000Z');

describe('native-sync-job repository', () => {
  let userId: string;

  beforeEach(() => {
    initDb();
    userId = createUser({ letterboxdId: 'lb-ns', letterboxdUsername: 'ns', refreshToken: 'fake' }).id;
  });

  afterEach(() => closeDb());

  const job = (over: Partial<{ imdbId: string; kind: 'diary' | 'watch_flag'; localDate: string; occurredAt: string }> = {}) => ({
    userId,
    imdbId: 'tt0816692',
    kind: 'diary' as const,
    localDate: '2026-10-08',
    occurredAt: T0.toISOString(),
    ...over,
  });

  it('deduplicates on member, film, kind and local day', () => {
    expect(enqueueJob(job())).toBe(true);
    expect(enqueueJob(job())).toBe(false); // seek burst replay
    expect(enqueueJob(job({ kind: 'watch_flag' }))).toBe(true);
    expect(enqueueJob(job({ localDate: '2026-10-09' }))).toBe(true); // rewatch next day
  });

  it('claims the oldest due job once and counts the attempt', () => {
    enqueueJob(job({ imdbId: 'tt2', occurredAt: '2026-10-08T12:00:01.000Z' }));
    enqueueJob(job({ imdbId: 'tt1', occurredAt: '2026-10-08T12:00:00.000Z' }));

    // Clock past both occurredAt values: a job is due at its occurredAt, and tt2 occurs 1s after T0.
    const later = new Date('2026-10-08T12:00:02.000Z');
    const first = claimNextJob(later);
    expect(first).toMatchObject({ imdbId: 'tt1', status: 'processing', attempts: 1 });
    expect(claimNextJob(later)?.imdbId).toBe('tt2');
    expect(claimNextJob(later)).toBeNull();
  });

  it('does not claim a job scheduled for later', () => {
    enqueueJob(job());
    const claimed = claimNextJob(T0)!;
    scheduleRetry(claimed.id, new Date(T0.getTime() + 60_000), 'upstream_5xx');
    expect(claimNextJob(T0)).toBeNull();
    expect(claimNextJob(new Date(T0.getTime() + 60_000))?.attempts).toBe(2);
  });

  it('reports a pending, processing or done diary job', () => {
    enqueueJob(job());
    expect(hasDiaryJob(userId, 'tt0816692', '2026-10-08')).toBe(true);
    expect(hasDiaryJob(userId, 'tt0816692', '2026-10-09')).toBe(false);
    const claimed = claimNextJob(T0)!;
    expect(hasDiaryJob(userId, 'tt0816692', '2026-10-08')).toBe(true);
    markDone(claimed.id);
    expect(hasDiaryJob(userId, 'tt0816692', '2026-10-08')).toBe(true);
  });

  it('finds a recent diary job for the same film whatever its local day', () => {
    enqueueJob(job({ localDate: '2026-10-07', occurredAt: '2026-10-08T11:00:00.000Z' }));
    expect(hasRecentDiaryJob(userId, 'tt0816692', '2026-10-08T06:00:00.000Z')).toBe(true);
    expect(hasRecentDiaryJob(userId, 'tt0816692', '2026-10-08T11:00:00.001Z')).toBe(false);
    expect(hasRecentDiaryJob(userId, 'tt1', '2026-10-08T06:00:00.000Z')).toBe(false);
    markDone(claimNextJob(T0)!.id);
    expect(hasRecentDiaryJob(userId, 'tt0816692', '2026-10-08T06:00:00.000Z')).toBe(true);
  });

  it('ignores watch flags and failed jobs when looking for a recent diary job', () => {
    enqueueJob(job({ kind: 'watch_flag' }));
    expect(hasRecentDiaryJob(userId, 'tt0816692', '2026-10-08T06:00:00.000Z')).toBe(false);
    enqueueJob(job());
    getDb().prepare("UPDATE native_sync_jobs SET status = 'failed' WHERE kind = 'diary'").run();
    expect(hasRecentDiaryJob(userId, 'tt0816692', '2026-10-08T06:00:00.000Z')).toBe(false);
  });

  it('counts diary jobs of any status for a member and local day', () => {
    enqueueJob(job({ imdbId: 'tt1' }));
    enqueueJob(job({ imdbId: 'tt2' }));
    enqueueJob(job({ imdbId: 'tt3', kind: 'watch_flag' }));
    enqueueJob(job({ imdbId: 'tt4', localDate: '2026-10-09' }));
    markFailed(claimNextJob(T0)!.id, 'rejected');
    expect(countDiaryJobsForDay(userId, '2026-10-08')).toBe(2);
    expect(countDiaryJobsForDay(userId, '2026-10-09')).toBe(1);
  });

  it('ignores a failed diary job', () => {
    enqueueJob(job());
    markFailed(claimNextJob(T0)!.id, 'film_not_found');
    expect(hasDiaryJob(userId, 'tt0816692', '2026-10-08')).toBe(false);
  });

  it('purges done rows two days after their local day and failed rows after 7 days', () => {
    enqueueJob(job({ imdbId: 'ttDoneOld', localDate: '2026-10-06' }));
    enqueueJob(job({ imdbId: 'ttDoneRecent', localDate: '2026-10-07' }));
    enqueueJob(job({ imdbId: 'ttFailedOld', occurredAt: '2026-09-30T00:00:00.000Z' }));
    enqueueJob(job({ imdbId: 'ttFailedRecent', occurredAt: '2026-10-07T00:00:00.000Z' }));
    for (let j = claimNextJob(new Date('2030-01-01')); j; j = claimNextJob(new Date('2030-01-01'))) {
      if (j.imdbId.startsWith('ttDone')) markDone(j.id);
      else markFailed(j.id, 'film_not_found');
    }

    expect(purgeJobs(T0)).toBe(2);
    const left = getDb().prepare('SELECT imdb_id FROM native_sync_jobs ORDER BY imdb_id').all() as Array<{ imdb_id: string }>;
    expect(left.map((r) => r.imdb_id)).toEqual(['ttDoneRecent', 'ttFailedRecent']);
  });

  it('puts processing rows back to pending after a crash', () => {
    enqueueJob(job());
    claimNextJob(T0);
    expect(resetStaleProcessing()).toBe(1);
    expect(claimNextJob(T0)?.attempts).toBe(2);
  });

  it('removes jobs when the user is deleted', () => {
    enqueueJob(job());
    getDb().prepare('DELETE FROM users WHERE id = ?').run(userId);
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM native_sync_jobs').get()).toEqual({ n: 0 });
  });

  it('reschedules without consuming an attempt', () => {
    enqueueJob(job());
    const claimed = claimNextJob(T0)!;
    expect(claimed.attempts).toBe(1);
    scheduleRetryKeepingAttempts(claimed.id, new Date(T0.getTime() + 60_000), 'entitlement_unavailable');
    const again = claimNextJob(new Date(T0.getTime() + 60_000))!;
    expect(again.attempts).toBe(1);
    expect(again.lastError).toBe('entitlement_unavailable');
  });
});
