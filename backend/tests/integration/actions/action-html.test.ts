import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { buildApp } from '../../../src/app.js';
import { initDb, closeDb } from '../../../src/db/index.js';
import { createUser } from '../../../src/db/repositories/user.repository.js';
import { signAction } from '../../../src/lib/action-sign.js';
import type { FastifyInstance } from 'fastify';

const { getEntitlementMock } = vi.hoisted(() => ({ getEntitlementMock: vi.fn() }));

vi.mock('../../../src/modules/billing/billing.service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/modules/billing/billing.service.js')>();
  return { ...actual, getEntitlement: getEntitlementMock };
});

// The action hits Letterboxd through the user's client; keep it offline.
vi.mock('../../../src/modules/stremio/user-client.service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/modules/stremio/user-client.service.js')>();
  return {
    ...actual,
    createClientForUser: vi.fn().mockResolvedValue({
      updateFilmRelationship: vi.fn().mockResolvedValue({ data: { watched: true, liked: false, inWatchlist: false } }),
    }),
  };
});

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

  describe('Auto-log to Diary upsell', () => {
    const UPSELL = 'Auto-log to Diary adds every film you finish to your Letterboxd diary, automatically.';

    beforeEach(() => getEntitlementMock.mockReset());

    async function run(action: string, set: boolean) {
      const filmId = 'upsellFilm';
      const tok = signAction(testUserId, filmId, action);
      const res = await app.inject({
        method: 'GET',
        url: `/action/${testUserId}/${action}/${filmId}?set=${set}&imdb=tt0111161&tok=${tok}`,
      });
      return res;
    }

    it('shows the line and waits 3 s for a non-supporter marking watched', async () => {
      getEntitlementMock.mockResolvedValue(false);
      const res = await run('watched', true);
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain(UPSELL);
      expect(res.body).toContain('href="http://localhost:3000/pricing"');
      expect(res.body).toContain('content="3;url=');
      // The JS redirect must wait as long as the meta refresh, or the line is gone in 0.8 s.
      expect(res.body).toContain('}, 3000);');
      expect(res.body).not.toContain('}, 800);');
    });

    it('shows nothing extra for a supporter', async () => {
      getEntitlementMock.mockResolvedValue(true);
      const res = await run('watched', true);
      expect(res.body).not.toContain(UPSELL);
      expect(res.body).toContain('content="1;url=');
      expect(res.body).toContain('}, 800);');
    });

    it('does not upsell on like', async () => {
      getEntitlementMock.mockResolvedValue(false);
      const res = await run('liked', true);
      expect(res.body).not.toContain(UPSELL);
      expect(res.body).toContain('content="1;url=');
      expect(getEntitlementMock).not.toHaveBeenCalled();
    });

    it('does not upsell when un-watching', async () => {
      getEntitlementMock.mockResolvedValue(false);
      const res = await run('watched', false);
      expect(res.body).not.toContain(UPSELL);
      expect(res.body).toContain('content="1;url=');
    });
  });
});
