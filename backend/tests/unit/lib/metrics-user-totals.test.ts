import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initDb, closeDb, getDb } from '../../../src/db/index.js';
import { createUser, upsertTier1User } from '../../../src/db/repositories/user.repository.js';
import { getTotalUniqueUsers, purgeOldEventsInBatches } from '../../../src/lib/metrics.js';

describe('getTotalUniqueUsers', () => {
  beforeEach(() => initDb());
  afterEach(() => closeDb());

  it('counts every registered user per tier, even with no events at all', () => {
    upsertTier1User('lb-t1-a', 'public_a');
    upsertTier1User('lb-t1-b', 'public_b');
    createUser({ letterboxdId: 'lb-t2-a', letterboxdUsername: 'auth_a', refreshToken: 'fake' });
    createUser({ letterboxdId: 'lb-t2-b', letterboxdUsername: 'auth_b', refreshToken: 'fake' });
    createUser({ letterboxdId: 'lb-t2-c', letterboxdUsername: 'auth_c', refreshToken: 'fake' });

    expect(getTotalUniqueUsers()).toEqual({ tier1: 2, tier2: 3, total: 5 });
  });

  it('is unchanged after the event purge removes all their events', async () => {
    const tier1 = upsertTier1User('lb-t1-old', 'public_old');
    const tier2 = createUser({ letterboxdId: 'lb-t2-old', letterboxdUsername: 'auth_old', refreshToken: 'fake' });
    const oldDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const insert = getDb().prepare('INSERT INTO events (event, user_id, created_at) VALUES (?, ?, ?)');
    insert.run('catalog_popular', tier1.id, oldDate);
    insert.run('catalog_popular', tier2.id, oldDate);

    expect(await purgeOldEventsInBatches(14)).toBe(2);

    expect(getTotalUniqueUsers()).toEqual({ tier1: 1, tier2: 1, total: 2 });
  });
});
