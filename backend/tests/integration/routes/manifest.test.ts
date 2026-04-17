import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../../src/app.js';
import { initDb, closeDb } from '../../../src/db/index.js';
import { encodeConfig, type PublicConfig } from '../../../src/lib/config-encoding.js';
import type { FastifyInstance } from 'fastify';

describe('GET /manifest.json (base manifest)', () => {
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

  it('returns a valid Stremio manifest', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/manifest.json',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe('community.stremboxd');
    expect(body.types).toContain('movie');
    expect(body.catalogs).toBeDefined();
    expect(Array.isArray(body.catalogs)).toBe(true);
  });

  it('includes popular and top250 catalogs', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/manifest.json',
    });

    const body = res.json();
    const catalogIds = body.catalogs.map((c: { id: string }) => c.id);
    expect(catalogIds).toContain('letterboxd-popular');
    expect(catalogIds).toContain('letterboxd-top250');
  });

  it('includes search catalog', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/manifest.json',
    });

    const body = res.json();
    const catalogIds = body.catalogs.map((c: { id: string }) => c.id);
    expect(catalogIds).toContain('letterboxd-search');
  });

  it('sets CORS and cache headers', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/manifest.json',
    });

    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.headers['cache-control']).toContain('max-age=3600');
  });
});

describe('GET /:config/manifest.json (Tier 2 public config)', () => {
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

  it('returns 400 for malformed base64 config', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/not-valid-base64!!!/manifest.json',
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for valid base64 with invalid schema', async () => {
    const bad = Buffer.from(JSON.stringify({ unexpected: true })).toString('base64url');
    const res = await app.inject({
      method: 'GET',
      url: `/${bad}/manifest.json`,
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns manifest with popular catalog when enabled', async () => {
    const cfg: PublicConfig = {
      c: { popular: true, top250: false },
      l: [],
      r: false,
    };
    const encoded = encodeConfig(cfg);

    const res = await app.inject({
      method: 'GET',
      url: `/${encoded}/manifest.json`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    const catalogIds = body.catalogs.map((c: { id: string }) => c.id);
    expect(catalogIds).toContain('letterboxd-popular');
    expect(catalogIds).not.toContain('letterboxd-top250');
  });

  it('returns manifest with top250 when enabled', async () => {
    const cfg: PublicConfig = {
      c: { popular: false, top250: true },
      l: [],
      r: true,
    };
    const encoded = encodeConfig(cfg);

    const res = await app.inject({
      method: 'GET',
      url: `/${encoded}/manifest.json`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    const catalogIds = body.catalogs.map((c: { id: string }) => c.id);
    expect(catalogIds).toContain('letterboxd-top250');
    expect(catalogIds).not.toContain('letterboxd-popular');
  });

  it('includes list catalogs from config', async () => {
    const cfg: PublicConfig = {
      c: { popular: true, top250: false },
      l: ['abc123'],
      r: false,
    };
    const encoded = encodeConfig(cfg);

    const res = await app.inject({
      method: 'GET',
      url: `/${encoded}/manifest.json`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    const catalogIds = body.catalogs.map((c: { id: string }) => c.id);
    expect(catalogIds).toContain('letterboxd-list-abc123');
  });

  it('always includes search catalog', async () => {
    const cfg: PublicConfig = {
      c: { popular: false, top250: false },
      l: [],
      r: false,
    };
    const encoded = encodeConfig(cfg);

    const res = await app.inject({
      method: 'GET',
      url: `/${encoded}/manifest.json`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    const catalogIds = body.catalogs.map((c: { id: string }) => c.id);
    expect(catalogIds).toContain('letterboxd-search');
  });

  it('applies custom catalog names from config', async () => {
    const cfg: PublicConfig = {
      c: { popular: true, top250: false },
      l: [],
      r: false,
      n: { 'letterboxd-popular': 'My Custom Popular' },
    };
    const encoded = encodeConfig(cfg);

    const res = await app.inject({
      method: 'GET',
      url: `/${encoded}/manifest.json`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    const popular = body.catalogs.find((c: { id: string }) => c.id === 'letterboxd-popular');
    expect(popular?.name).toBe('My Custom Popular');
  });

  it('expands sort variants from config', async () => {
    const cfg: PublicConfig = {
      c: { popular: true, top250: false },
      l: [],
      r: false,
      s: { 'letterboxd-popular': ['shuffle'] },
    };
    const encoded = encodeConfig(cfg);

    const res = await app.inject({
      method: 'GET',
      url: `/${encoded}/manifest.json`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    const catalogIds = body.catalogs.map((c: { id: string }) => c.id);
    expect(catalogIds).toContain('letterboxd-popular--shuffle');
  });

  it('sets CORS header on config manifest', async () => {
    const cfg: PublicConfig = {
      c: { popular: true, top250: false },
      l: [],
      r: false,
    };
    const encoded = encodeConfig(cfg);

    const res = await app.inject({
      method: 'GET',
      url: `/${encoded}/manifest.json`,
    });

    expect(res.headers['access-control-allow-origin']).toBe('*');
  });
});
