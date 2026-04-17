import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../../src/app.js';
import { initDb, closeDb } from '../../../src/db/index.js';
import { encodeConfig, type PublicConfig } from '../../../src/lib/config-encoding.js';
import type { FastifyInstance } from 'fastify';

describe('GET /:config/meta/movie/:id.json', () => {
  let app: FastifyInstance;
  let validConfig: string;

  beforeAll(async () => {
    initDb();
    app = await buildApp();
    await app.ready();

    const cfg: PublicConfig = {
      c: { popular: true, top250: false },
      l: [],
      r: false,
    };
    validConfig = encodeConfig(cfg);
  });

  afterAll(async () => {
    await app.close();
    closeDb();
  });

  it('returns 400 for invalid IMDb ID format', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/${validConfig}/meta/movie/not-an-imdb-id.json`,
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for malformed config', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/bad-config/meta/movie/tt0111161.json',
    });

    expect(res.statusCode).toBe(400);
  });

  it('sets CORS and cache headers for valid request', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/${validConfig}/meta/movie/tt0111161.json`,
    });

    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['cache-control']).toContain('max-age=3600');
  });

  it('returns JSON for a valid IMDb ID', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/${validConfig}/meta/movie/tt0111161.json`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Meta might be null if Cinemeta is unreachable, but response should be valid
    expect(body).toHaveProperty('meta');
  });

  it('accepts IMDb IDs with varying digit count', async () => {
    // tt followed by 1-10 digits is valid per IMDB_REGEX
    const res = await app.inject({
      method: 'GET',
      url: `/${validConfig}/meta/movie/tt1.json`,
    });

    expect(res.statusCode).toBe(200);
  });
});
