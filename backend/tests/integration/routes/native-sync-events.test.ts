import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
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
