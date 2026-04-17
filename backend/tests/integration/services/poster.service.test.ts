import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../../src/app.js';
import { initDb, closeDb } from '../../../src/db/index.js';
import type { FastifyInstance } from 'fastify';

describe('poster service (via route)', () => {
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

  it('returns 400 when url parameter is missing', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/poster?rating=4.0',
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when rating parameter is missing', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/poster?url=https://a.ltrbxd.com/300.jpg',
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for invalid rating (out of range)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/poster?url=https://a.ltrbxd.com/300.jpg&rating=6.0',
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for negative rating', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/poster?url=https://a.ltrbxd.com/300.jpg&rating=-1.0',
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for non-Letterboxd domain', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/poster?url=https://evil.com/poster.jpg&rating=4.0',
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for invalid URL', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/poster?url=not-a-url&rating=4.0',
    });

    expect(res.statusCode).toBe(400);
  });

  it('accepts ltrbxd.com domain', async () => {
    // This will likely fail with 500 since we can't actually fetch the poster,
    // but it should NOT be 400 (domain validation passed)
    const res = await app.inject({
      method: 'GET',
      url: '/poster?url=https://a.ltrbxd.com/resized/poster.jpg&rating=4.0',
    });

    expect(res.statusCode).not.toBe(400);
  });
});
