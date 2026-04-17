import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../../src/app.js';
import { initDb, closeDb } from '../../../src/db/index.js';
import { signJwtToken } from '../../../src/lib/jwt.js';
import type { FastifyInstance } from 'fastify';

describe('dashboard routes (JWT protected)', () => {
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

  it('POST /api/dashboard/auth returns 401 with wrong password', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/dashboard/auth',
      payload: { password: 'wrong-password' },
    });

    expect(res.statusCode).toBe(401);
  });

  it('POST /api/dashboard/auth returns token with correct password', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/dashboard/auth',
      payload: { password: 'test-dashboard-password' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.token).toBeDefined();
    expect(typeof body.token).toBe('string');
  });

  it('GET /health/detailed returns 401 without JWT', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health/detailed',
    });

    expect(res.statusCode).toBe(401);
  });

  it('GET /health/detailed returns 200 with valid admin JWT', async () => {
    const token = await signJwtToken({ sub: 'dashboard', role: 'admin' }, '1h');

    const res = await app.inject({
      method: 'GET',
      url: '/health/detailed',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.system).toBeDefined();
    expect(body.caches).toBeDefined();
  });

  it('GET /health/detailed rejects JWT without admin role', async () => {
    const token = await signJwtToken({ sub: 'user', role: 'viewer' }, '1h');

    const res = await app.inject({
      method: 'GET',
      url: '/health/detailed',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(401);
  });

  it('GET /health/detailed rejects expired JWT', async () => {
    const token = await signJwtToken({ sub: 'dashboard', role: 'admin' }, '0s');
    // Token with 0s TTL is already expired

    const res = await app.inject({
      method: 'GET',
      url: '/health/detailed',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(401);
  });

  it('GET /health/detailed rejects malformed authorization header', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health/detailed',
      headers: { authorization: 'Basic abc123' },
    });

    expect(res.statusCode).toBe(401);
  });
});
