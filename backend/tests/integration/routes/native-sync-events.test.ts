import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../../src/app.js';
import { initDb, closeDb, getDb } from '../../../src/db/index.js';
import { createUser, updateUserPreferences } from '../../../src/db/repositories/user.repository.js';

const base = {
  catalogs: { watchlist: true, diary: false, friends: false, popular: false, top250: false, likedFilms: false, recommended: false },
  ownLists: [],
  externalLists: [],
};

function jobs(): Array<{ imdb_id: string; kind: string }> {
  return getDb().prepare('SELECT imdb_id, kind FROM native_sync_jobs ORDER BY id').all() as Array<{ imdb_id: string; kind: string }>;
}

function diaryDays(): string[] {
  return (getDb().prepare("SELECT local_date FROM native_sync_jobs WHERE kind = 'diary' ORDER BY id").all() as Array<{ local_date: string }>).map(
    (r) => r.local_date,
  );
}

describe('native sync event routes', () => {
  let app: FastifyInstance;
  let userId: string;

  beforeAll(async () => {
    initDb();
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    closeDb();
  });

  beforeEach(() => {
    getDb().prepare('DELETE FROM native_sync_jobs').run();
    userId = createUser({ letterboxdId: `lb-${Math.random()}`, letterboxdUsername: 'nse', refreshToken: 'fake' }).id;
    updateUserPreferences(userId, { ...base, nativeSync: true, timezone: 'Europe/Paris' });
  });

  const get = (url: string) => app.inject({ method: 'GET', url });

  it('queues a diary job for a stop past 80% and answers success', async () => {
    const res = await get(`/stremio/${userId}/player/movie/tt0816692/action=stop&currentTime=8000&duration=10000.json`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true });
    expect(jobs()).toEqual([{ imdb_id: 'tt0816692', kind: 'diary' }]);
  });

  it('queues one job for a burst of pauses past the threshold', async () => {
    for (const t of [9000, 9100, 9200]) {
      await get(`/stremio/${userId}/player/movie/tt0816692/action=pause&currentTime=${t}&duration=10000.json`);
    }
    expect(jobs()).toHaveLength(1);
  });

  it('queues a watch flag job for a library watched mark', async () => {
    await get(`/stremio/${userId}/library/movie/tt0816692/action=watched.json`);
    expect(jobs()).toEqual([{ imdb_id: 'tt0816692', kind: 'watch_flag' }]);
  });

  it.each([
    ['below threshold', 'player/movie/tt1/action=stop&currentTime=100&duration=10000'],
    ['start', 'player/movie/tt1/action=start&currentTime=9999&duration=10000'],
    ['malformed time', 'player/movie/tt1/action=stop&currentTime=abc&duration=10000'],
    ['zero duration', 'player/movie/tt1/action=stop&currentTime=0&duration=0'],
    ['series', 'player/series/tt1:1:1/action=stop&currentTime=9999&duration=10000'],
    ['non-imdb id', 'player/movie/kitsu:1/action=stop&currentTime=9999&duration=10000'],
    ['unwatched', 'library/movie/tt1/action=unwatched'],
    ['library add', 'library/movie/tt1/action=libraryAdd'],
  ])('answers success but queues nothing for %s', async (_label, path) => {
    const res = await get(`/stremio/${userId}/${path}.json`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true });
    expect(jobs()).toEqual([]);
  });

  describe('one viewing, one diary job', () => {
    afterEach(() => vi.useRealTimers());
    const at = (iso: string) => vi.setSystemTime(new Date(iso));
    const pause = () => get(`/stremio/${userId}/player/movie/tt0816692/action=pause&currentTime=8500&duration=10000.json`);
    const stop = () => get(`/stremio/${userId}/player/movie/tt0816692/action=stop&currentTime=9900&duration=10000.json`);

    it('queues one job for a pause before midnight and a stop after it', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      at('2026-10-08T21:55:00.000Z'); // 23:55 in Paris
      await pause();
      at('2026-10-08T22:10:00.000Z'); // 00:10 the next day in Paris
      await stop();
      expect(diaryDays()).toEqual(['2026-10-08']);
    });

    it('queues a second job for the same film seven hours later on the next day', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      at('2026-10-08T20:00:00.000Z'); // 22:00 in Paris
      await stop();
      at('2026-10-09T03:00:00.000Z'); // 05:00 the next day: a genuine rewatch
      await stop();
      expect(diaryDays()).toEqual(['2026-10-08', '2026-10-09']);
    });
  });

  it('drops diary jobs past ten for the same day', async () => {
    for (let i = 1; i <= 11; i++) {
      const res = await get(`/stremio/${userId}/player/movie/tt${i}/action=stop&currentTime=9900&duration=10000.json`);
      expect(res.json()).toEqual({ success: true });
    }
    expect(jobs()).toHaveLength(10);
    expect(jobs().map((j) => j.imdb_id)).not.toContain('tt11');
  });

  it('rate limits each member on their own, not by address', async () => {
    const other = createUser({ letterboxdId: `lb-${Math.random()}`, letterboxdUsername: 'nse2', refreshToken: 'fake' }).id;
    const path = (u: string) => `/stremio/${u}/library/movie/tt1/action=libraryAdd.json`;
    for (let i = 0; i < 120; i++) expect((await get(path(userId))).statusCode).toBe(200);
    expect((await get(path(userId))).statusCode).toBe(429);
    expect((await get(path(other))).statusCode).toBe(200);
  });

  it('queues nothing when the member has not opted in', async () => {
    updateUserPreferences(userId, { ...base });
    await get(`/stremio/${userId}/player/movie/tt1/action=stop&currentTime=9999&duration=10000.json`);
    expect(jobs()).toEqual([]);
  });

  it('answers success for an unknown user', async () => {
    const res = await get('/stremio/does-not-exist/player/movie/tt1/action=stop&currentTime=9999&duration=10000.json');
    expect(res.json()).toEqual({ success: true });
    expect(jobs()).toEqual([]);
  });
});
