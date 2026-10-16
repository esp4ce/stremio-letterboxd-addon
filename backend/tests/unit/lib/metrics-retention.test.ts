import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initDb, closeDb, getDb } from '../../../src/db/index.js';
import { purgeOldEventsInBatches } from '../../../src/lib/metrics.js';

const DAY = 24 * 60 * 60 * 1000;
const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY).toISOString();

function insertEvents(count: number, daysAgo: number) {
  const insert = getDb().prepare('INSERT INTO events (event, created_at) VALUES (?, ?)');
  for (let i = 0; i < count; i++) insert.run('catalog_popular', iso(daysAgo));
}

const countEvents = () =>
  (getDb().prepare('SELECT COUNT(*) AS c FROM events').get() as { c: number }).c;

describe('purgeOldEventsInBatches', () => {
  beforeEach(() => initDb());
  afterEach(() => closeDb());

  it('deletes events older than the retention window and keeps recent ones', async () => {
    insertEvents(12, 60);
    insertEvents(3, 1);

    const deleted = await purgeOldEventsInBatches(14, 5);

    expect(deleted).toBe(12);
    expect(countEvents()).toBe(3);
  });

  it('deletes in bounded batches and lets the event loop run in between', async () => {
    insertEvents(25, 60);

    const order: string[] = [];
    setImmediate(() => order.push('other work'));
    const deleted = await purgeOldEventsInBatches(14, 5);
    order.push('purge done');

    expect(deleted).toBe(25);
    expect(order).toEqual(['other work', 'purge done']);
  });

  it('never purges the low-volume events that record who joined and why they support', async () => {
    const insert = getDb().prepare('INSERT INTO events (event, created_at) VALUES (?, ?)');
    for (const event of ['install', 'login', 'supporter_reason', 'catalog_popular', 'stream']) {
      insert.run(event, iso(200));
    }

    const deleted = await purgeOldEventsInBatches(14, 5);

    const kept = (getDb().prepare('SELECT event FROM events ORDER BY event').all() as Array<{ event: string }>)
      .map((row) => row.event);
    expect(deleted).toBe(2);
    expect(kept).toEqual(['install', 'login', 'supporter_reason']);
  });

  it('returns 0 and touches nothing when everything is recent', async () => {
    insertEvents(4, 2);

    expect(await purgeOldEventsInBatches(14, 5)).toBe(0);
    expect(countEvents()).toBe(4);
  });

  it('does not stop early when the old events are an exact multiple of the batch size', async () => {
    insertEvents(10, 60);
    insertEvents(2, 1);

    expect(await purgeOldEventsInBatches(14, 5)).toBe(10);
    expect(countEvents()).toBe(2);
  });
});
