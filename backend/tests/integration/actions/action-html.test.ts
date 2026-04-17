import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../../src/app.js';
import { initDb, closeDb } from '../../../src/db/index.js';
import { createUser } from '../../../src/db/repositories/user.repository.js';
import { signAction } from '../../../src/lib/action-sign.js';
import type { FastifyInstance } from 'fastify';

describe('action routes (rate/watched/liked/watchlist buttons)', () => {
  let app: FastifyInstance;
  let testUserId: string;

  beforeAll(async () => {
    initDb();
    app = await buildApp();
    await app.ready();

    const user = createUser({
      letterboxdId: 'action-test-user',
      letterboxdUsername: 'actionuser',
      refreshToken: 'fake-refresh-for-action',
    });
    testUserId = user.id;
  });

  afterAll(async () => {
    await app.close();
    closeDb();
  });

  it('rejects request with missing token (403)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/action/${testUserId}/watched/abc123?set=true`,
    });

    expect(res.statusCode).toBe(403);
  });

  it('rejects request with invalid token (403)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/action/${testUserId}/watched/abc123?set=true&tok=0000000000000000`,
    });

    expect(res.statusCode).toBe(403);
  });

  it('rejects request with wrong action in token (403)', async () => {
    const tok = signAction(testUserId, 'abc123', 'liked');

    const res = await app.inject({
      method: 'GET',
      url: `/action/${testUserId}/watched/abc123?set=true&tok=${tok}`,
    });

    expect(res.statusCode).toBe(403);
  });

  it('accepts valid signed action token', async () => {
    const filmId = 'validFilmId';
    const tok = signAction(testUserId, filmId, 'watched');

    const res = await app.inject({
      method: 'GET',
      url: `/action/${testUserId}/watched/${filmId}?set=true&tok=${tok}`,
    });

    // The action will try to call Letterboxd via the user client,
    // which will fail (no real token). But it should NOT be 403.
    // It will be either 200 (success HTML) or 500 (Letterboxd error HTML)
    expect(res.statusCode).not.toBe(403);
  });

  describe('rating page', () => {
    it('rejects rate page without token', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/action/${testUserId}/rate/abc123`,
      });

      expect(res.statusCode).toBe(403);
    });

    it('renders rating page with valid token', async () => {
      const filmId = 'rateFilmId';
      const tok = signAction(testUserId, filmId, 'rate');

      const res = await app.inject({
        method: 'GET',
        url: `/action/${testUserId}/rate/${filmId}?tok=${tok}&name=TestFilm`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
    });

    it('rejects rate submit without token', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/action/${testUserId}/rate/abc123/submit?rating=4.0`,
      });

      expect(res.statusCode).toBe(403);
    });
  });
});
