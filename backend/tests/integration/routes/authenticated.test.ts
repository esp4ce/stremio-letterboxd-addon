import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../../src/app.js';
import { initDb, closeDb } from '../../../src/db/index.js';
import { createUser } from '../../../src/db/repositories/user.repository.js';
import type { FastifyInstance } from 'fastify';

describe('Tier 2 authenticated routes /stremio/:userId/...', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    initDb();
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    closeDb();
  });

  it('returns 404 for unknown userId on manifest', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/stremio/nonexistent-user-id/manifest.json',
    });

    expect(res.statusCode).toBe(404);
  });

  it('returns manifest for existing user', async () => {
    const user = createUser({
      letterboxdId: 'auth-test-manifest',
      letterboxdUsername: 'authtestuser',
      letterboxdDisplayName: 'Auth Test',
      refreshToken: 'fake-refresh-token',
    });

    const res = await app.inject({
      method: 'GET',
      url: `/stremio/${user.id}/manifest.json`,
    });

    // The manifest may succeed or fall back to static depending on
    // whether app token works, but it should NOT 500
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe('community.stremboxd');
    expect(body.catalogs).toBeDefined();
  });

  it('returns 404 for unknown userId on catalog', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/stremio/nonexistent-user-id/catalog/movie/letterboxd-watchlist.json',
    });

    expect(res.statusCode).toBe(404);
  });

  it('sets CORS headers on authenticated routes', async () => {
    const user = createUser({
      letterboxdId: 'auth-test-cors',
      letterboxdUsername: 'corsuser',
      refreshToken: 'fake-token',
    });

    const res = await app.inject({
      method: 'GET',
      url: `/stremio/${user.id}/manifest.json`,
    });

    expect(res.headers['access-control-allow-origin']).toBe('*');
  });
});
