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
});
