import type Database from 'better-sqlite3';
import { createChildLogger } from './logger.js';

const log = createChildLogger('db-footprint');

const MB = 1024 * 1024;
const FIRST_RUN_DELAY_MS = 2 * 60_000;
const EVERY_MS = 24 * 60 * 60_000;
const TOP_EVENT_TYPES = 10;
const ROW_SAMPLE = 2000;

export interface DbFootprint {
  fileMB: number;
  /** Pages SQLite keeps free after deletes: file space a VACUUM would give back. */
  freelistMB: number;
  rows: Record<string, number>;
  eventsOldest: string | null;
  eventsNewest: string | null;
  /** Average bytes of the text columns of the newest events, indexes excluded. */
  eventsAvgRowBytes: number;
  topEventTypes: Array<{ event: string; rows: number }>;
}

const quote = (identifier: string) => `"${identifier.replace(/"/g, '""')}"`;

/**
 * Cheap picture of what fills the database. Never scans the whole file (unlike dbstat):
 * a full scan would load every page into the file cache, the very cost being measured.
 * Counts and the type breakdown read only the smallest covering index.
 */
export function sampleDbFootprint(db: Database.Database): DbFootprint {
  const pageSize = db.pragma('page_size', { simple: true }) as number;
  const pageCount = db.pragma('page_count', { simple: true }) as number;
  const freelist = db.pragma('freelist_count', { simple: true }) as number;

  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all() as Array<{ name: string }>;

  const rows: Record<string, number> = {};
  for (const { name } of tables) {
    rows[name] = (db.prepare(`SELECT count(*) AS n FROM ${quote(name)}`).get() as { n: number }).n;
  }

  let eventsOldest: string | null = null;
  let eventsNewest: string | null = null;
  let eventsAvgRowBytes = 0;
  let topEventTypes: DbFootprint['topEventTypes'] = [];

  if ((rows['events'] ?? 0) > 0) {
    const range = db.prepare('SELECT min(created_at) AS a, max(created_at) AS b FROM events').get() as {
      a: string | null;
      b: string | null;
    };
    eventsOldest = range.a;
    eventsNewest = range.b;

    const avg = db
      .prepare(
        `SELECT avg(length(event) + length(coalesce(user_id, '')) + length(coalesce(metadata, ''))
                + length(coalesce(anonymous_id, '')) + length(created_at)) AS bytes
         FROM (SELECT event, user_id, metadata, anonymous_id, created_at FROM events ORDER BY id DESC LIMIT ?)`,
      )
      .get(ROW_SAMPLE) as { bytes: number | null };
    eventsAvgRowBytes = Math.round(avg.bytes ?? 0);

    topEventTypes = db
      .prepare('SELECT event, count(*) AS rows FROM events GROUP BY event ORDER BY rows DESC LIMIT ?')
      .all(TOP_EVENT_TYPES) as DbFootprint['topEventTypes'];
  }

  return {
    fileMB: Math.round((pageSize * pageCount) / MB),
    freelistMB: Math.round((pageSize * freelist) / MB),
    rows,
    eventsOldest,
    eventsNewest,
    eventsAvgRowBytes,
    topEventTypes,
  };
}

/** Logs the database footprint shortly after start, then once a day. Returns a stop function. */
export function startDbFootprintLog(getDb: () => Database.Database): () => void {
  const run = () => {
    try {
      log.info(sampleDbFootprint(getDb()), 'Database footprint');
    } catch (err) {
      log.warn({ err: err instanceof Error ? err.message : 'unknown error' }, 'Database footprint failed');
    }
  };

  let interval: NodeJS.Timeout | undefined;
  const first = setTimeout(() => {
    run();
    interval = setInterval(run, EVERY_MS);
    interval.unref();
  }, FIRST_RUN_DELAY_MS);
  first.unref();

  return () => {
    clearTimeout(first);
    if (interval) clearInterval(interval);
  };
}
