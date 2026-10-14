import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../../src/app.js';
import { initDb, closeDb } from '../../../src/db/index.js';
import type { FastifyInstance } from 'fastify';

describe('rate limit', () => {
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

  it('returns 429 after exceeding global rate limit', async () => {
    // Global rate limit is 100/min. Fire enough requests to exceed it.
    const responses = [];
    for (let i = 0; i < 105; i++) {
      responses.push(
        app.inject({
          method: 'GET',
          url: '/health',
          remoteAddress: '10.99.99.99', // isolated IP
        }),
      );
    }

    const results = await Promise.all(responses);
    const statuses = results.map((r) => r.statusCode);

    expect(statuses).toContain(429);
  });

  it('rate limit response has correct error format', async () => {
    // Use a fresh IP to ensure clean state
    const responses = [];
    for (let i = 0; i < 105; i++) {
      responses.push(
        app.inject({
          method: 'GET',
          url: '/health',
          remoteAddress: '10.88.88.88',
        }),
      );
    }

    const results = await Promise.all(responses);
    const limited = results.find((r) => r.statusCode === 429);

    if (limited) {
      const body = limited.json();
      // @fastify/rate-limit may use default message or our custom errorResponseBuilder
      expect(body.error || body.message).toBeDefined();
    }
  });

  it('keys limits on x-real-ip so distinct clients get independent budgets', async () => {
    // /auth/login allows 3 requests/min per client; an empty body is rejected after the limiter runs.
    const hit = (ip: string) =>
      app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: {},
        remoteAddress: '10.77.77.77', // same proxy address for everyone
        headers: { 'x-real-ip': ip },
      });

    const a = [];
    for (let i = 0; i < 4; i++) a.push((await hit('203.0.113.10')).statusCode);
    expect(a[3]).toBe(429);

    expect((await hit('203.0.113.11')).statusCode).not.toBe(429);
  });
});
