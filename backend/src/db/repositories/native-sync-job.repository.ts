import { getDb } from '../index.js';
import type { JobKind } from '../../modules/native-sync/job-rules.js';

export type NativeSyncJobStatus = 'pending' | 'processing' | 'done' | 'failed';

export interface NativeSyncJob {
  id: number;
  userId: string;
  imdbId: string;
  kind: JobKind;
  localDate: string;
  occurredAt: string;
  status: NativeSyncJobStatus;
  attempts: number;
  nextAttemptAt: string;
  lastError: string | null;
}

interface JobRow {
  id: number;
  user_id: string;
  imdb_id: string;
  kind: JobKind;
  local_date: string;
  occurred_at: string;
  status: NativeSyncJobStatus;
  attempts: number;
  next_attempt_at: string;
  last_error: string | null;
}

function toJob(row: JobRow): NativeSyncJob {
  return {
    id: row.id,
    userId: row.user_id,
    imdbId: row.imdb_id,
    kind: row.kind,
    localDate: row.local_date,
    occurredAt: row.occurred_at,
    status: row.status,
    attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at,
    lastError: row.last_error,
  };
}

export function enqueueJob(input: {
  userId: string;
  imdbId: string;
  kind: JobKind;
  localDate: string;
  occurredAt: string;
}): boolean {
  const result = getDb()
    .prepare(
      `INSERT OR IGNORE INTO native_sync_jobs (user_id, imdb_id, kind, local_date, occurred_at, next_attempt_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(input.userId, input.imdbId, input.kind, input.localDate, input.occurredAt, input.occurredAt);
  return result.changes === 1;
}

export function claimNextJob(now: Date): NativeSyncJob | null {
  const row = getDb()
    .prepare(
      `UPDATE native_sync_jobs
       SET status = 'processing', attempts = attempts + 1
       WHERE id = (
         SELECT id FROM native_sync_jobs
         WHERE status = 'pending' AND next_attempt_at <= ?
         ORDER BY occurred_at, id
         LIMIT 1
       )
       RETURNING *`,
    )
    .get(now.toISOString()) as JobRow | undefined;
  return row ? toJob(row) : null;
}

export function markDone(id: number): void {
  getDb().prepare(`UPDATE native_sync_jobs SET status = 'done', last_error = NULL WHERE id = ?`).run(id);
}

export function markFailed(id: number, error: string): void {
  getDb().prepare(`UPDATE native_sync_jobs SET status = 'failed', last_error = ? WHERE id = ?`).run(error, id);
}

export function scheduleRetry(id: number, nextAttemptAt: Date, error: string): void {
  getDb()
    .prepare(`UPDATE native_sync_jobs SET status = 'pending', next_attempt_at = ?, last_error = ? WHERE id = ?`)
    .run(nextAttemptAt.toISOString(), error, id);
}

/** Reschedule without spending an attempt (claim incremented it), for waits that are not the job's fault. */
export function scheduleRetryKeepingAttempts(id: number, nextAttemptAt: Date, error: string): void {
  getDb()
    .prepare(
      `UPDATE native_sync_jobs SET status = 'pending', attempts = MAX(attempts - 1, 0), next_attempt_at = ?, last_error = ? WHERE id = ?`,
    )
    .run(nextAttemptAt.toISOString(), error, id);
}

export function deleteJob(id: number): void {
  getDb().prepare('DELETE FROM native_sync_jobs WHERE id = ?').run(id);
}

export function hasDiaryJob(userId: string, imdbId: string, localDate: string): boolean {
  const row = getDb()
    .prepare(
      `SELECT 1 FROM native_sync_jobs WHERE user_id = ? AND imdb_id = ? AND local_date = ? AND kind = 'diary'
         AND status IN ('pending', 'processing', 'done') LIMIT 1`,
    )
    .get(userId, imdbId, localDate);
  return row !== undefined;
}

/** A live or written diary job for this film that occurred at or after `since`, whatever its local day. */
export function hasRecentDiaryJob(userId: string, imdbId: string, since: string): boolean {
  const row = getDb()
    .prepare(
      `SELECT 1 FROM native_sync_jobs WHERE user_id = ? AND imdb_id = ? AND kind = 'diary'
         AND status IN ('pending', 'processing', 'done') AND occurred_at >= ? LIMIT 1`,
    )
    .get(userId, imdbId, since);
  return row !== undefined;
}

export function countDiaryJobsForDay(userId: string, localDate: string): number {
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS n FROM native_sync_jobs WHERE user_id = ? AND local_date = ? AND kind = 'diary'`)
    .get(userId, localDate) as { n: number };
  return row.n;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Done rows: local_date at least 2 days before today (UTC) — past every timezone's day end. Failed rows: 7 days. */
export function purgeJobs(now: Date): number {
  const doneCutoff = new Date(now.getTime() - 2 * DAY_MS).toISOString().slice(0, 10);
  const failedCutoff = new Date(now.getTime() - 7 * DAY_MS).toISOString();
  const result = getDb()
    .prepare(
      `DELETE FROM native_sync_jobs
       WHERE (status = 'done' AND local_date <= ?)
          OR (status = 'failed' AND occurred_at < ?)`,
    )
    .run(doneCutoff, failedCutoff);
  return result.changes;
}

export function resetStaleProcessing(): number {
  return getDb().prepare(`UPDATE native_sync_jobs SET status = 'pending' WHERE status = 'processing'`).run().changes;
}
