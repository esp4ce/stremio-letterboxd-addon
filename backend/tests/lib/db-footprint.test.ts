import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { sampleDbFootprint } from '../../src/lib/db-footprint.js';

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY);
    CREATE TABLE events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event TEXT NOT NULL,
      user_id TEXT,
      metadata TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      anonymous_id TEXT
    );
    CREATE INDEX idx_events_event ON events(event);
  `);
  return db;
}

describe('sampleDbFootprint', () => {
  it('counts rows per table and ranks event types', () => {
    const db = createDb();
    db.prepare('INSERT INTO users (id) VALUES (?)').run('u1');
    const insert = db.prepare('INSERT INTO events (event, metadata, created_at) VALUES (?, ?, ?)');
    for (let i = 0; i < 5; i++) insert.run('catalog_diary', 'x'.repeat(10), `2026-11-0${i + 1} 10:00:00`);
    insert.run('install', null, '2026-11-09 10:00:00');

    const result = sampleDbFootprint(db);

    expect(result.rows).toMatchObject({ users: 1, events: 6 });
    expect(result.topEventTypes[0]).toEqual({ event: 'catalog_diary', rows: 5 });
    expect(result.eventsOldest).toBe('2026-11-01 10:00:00');
    expect(result.eventsNewest).toBe('2026-11-09 10:00:00');
    expect(result.eventsAvgRowBytes).toBeGreaterThan(0);
  });

  it('reports free pages left behind by deletes', () => {
    const db = createDb();
    const insert = db.prepare('INSERT INTO events (event, metadata) VALUES (?, ?)');
    for (let i = 0; i < 2000; i++) insert.run('e', 'y'.repeat(500));
    db.exec('DELETE FROM events');

    const result = sampleDbFootprint(db);

    expect(result.rows.events).toBe(0);
    expect(result.freelistMB).toBeGreaterThanOrEqual(1);
    expect(result.eventsOldest).toBeNull();
  });
});
