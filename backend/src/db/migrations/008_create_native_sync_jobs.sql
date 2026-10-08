-- Migration: 008_create_native_sync_jobs
-- Outbox for Native Sync. Holds no title, username or Letterboxd id: a viewing
-- is forgotten once written (done rows purged after their local day).

CREATE TABLE IF NOT EXISTS native_sync_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  imdb_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('diary', 'watch_flag')),
  local_date TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'done', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  last_error TEXT,
  UNIQUE (user_id, imdb_id, kind, local_date)
);

CREATE INDEX IF NOT EXISTS idx_native_sync_jobs_due ON native_sync_jobs (status, next_attempt_at);
