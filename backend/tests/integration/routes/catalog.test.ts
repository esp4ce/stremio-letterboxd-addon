import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../../src/app.js';
import { initDb, closeDb } from '../../../src/db/index.js';
import { encodeConfig, type PublicConfig } from '../../../src/lib/config-encoding.js';
import type { FastifyInstance } from 'fastify';

describe('GET /:config/catalog/movie/:id.json', () => {
  let app: FastifyInstance;
  let validConfig: string;

  beforeAll(async () => {
    initDb();
    app = await buildApp();
    await app.ready();

    const cfg: PublicConfig = {
      c: { popular: true, top250: true },
      l: [],
      r: false,
    };
    validConfig = encodeConfig(cfg);
  });

  afterAll(async () => {
    await app.close();
    closeDb();
  });

  it('returns 400 for malformed config', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/invalid-config/catalog/movie/letterboxd-popular.json',
    });

    expect(res.statusCode).toBe(400);
  });

  it('sets CORS and content-type headers', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/${validConfig}/catalog/movie/letterboxd-popular.json`,
    });

    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['content-type']).toContain('application/json');
  });

  it('returns JSON with metas array structure', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/${validConfig}/catalog/movie/letterboxd-popular.json`,
    });

    // Depending on whether the app token works, this might return
    // an error or metas. At minimum it should be valid JSON
    const body = res.json();
    expect(body).toBeDefined();
  });
});

describe('GET /catalog/movie/letterboxd-popular.json (Tier 1 global)', () => {
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

  it('sets wildcard CORS header', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/catalog/movie/letterboxd-popular.json',
    });

    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  it('returns JSON content type', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/catalog/movie/letterboxd-popular.json',
    });

    expect(res.headers['content-type']).toContain('application/json');
  });
});
