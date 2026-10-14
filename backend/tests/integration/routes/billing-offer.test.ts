import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { http, HttpResponse } from 'msw';
import { mswServer } from '../../helpers/msw-server.js';
import { buildApp } from '../../../src/app.js';
import { initDb, closeDb } from '../../../src/db/index.js';
import { clearOfferCache } from '../../../src/modules/billing/billing.service.js';

const POLAR = 'https://sandbox-api.polar.sh';
const count = (n: number) => HttpResponse.json({ items: [], pagination: { total_count: n, max_page: n } });

describe('GET /billing/offer', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    mswServer.listen({ onUnhandledRequest: 'bypass' });
    initDb();
    app = await buildApp();
    await app.ready();
  });

  afterEach(() => {
    mswServer.resetHandlers();
    clearOfferCache();
  });

  afterAll(async () => {
    await app.close();
    closeDb();
    mswServer.close();
  });

  it('returns supporters (subscriptions + Founder seats) and seats left, without a session', async () => {
    mswServer.use(
      http.get(`${POLAR}/v1/subscriptions/`, () => count(18)),
      http.get(`${POLAR}/v1/orders/`, () => count(3)),
    );
    const res = await app.inject({ method: 'GET', url: '/billing/offer' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ supporters: 21, founder: { seatsLeft: 17 } });
    expect(res.headers['cache-control']).toBe('public, max-age=300');
  });

  it('hides the supporter count below 10', async () => {
    mswServer.use(
      http.get(`${POLAR}/v1/subscriptions/`, () => count(8)),
      http.get(`${POLAR}/v1/orders/`, () => count(1)),
    );
    const res = await app.inject({ method: 'GET', url: '/billing/offer' });
    expect(res.json()).toEqual({ supporters: null, founder: { seatsLeft: 19 } });
  });

  it('hides the Founder offer once all 20 seats are sold', async () => {
    mswServer.use(
      http.get(`${POLAR}/v1/subscriptions/`, () => count(18)),
      http.get(`${POLAR}/v1/orders/`, () => count(21)),
    );
    const res = await app.inject({ method: 'GET', url: '/billing/offer' });
    expect(res.json()).toEqual({ supporters: 39, founder: null });
  });

  it('degrades to nulls, not a 500, when Polar refuses (e.g. missing scope)', async () => {
    mswServer.use(
      http.get(`${POLAR}/v1/subscriptions/`, () => HttpResponse.json({}, { status: 403 })),
      http.get(`${POLAR}/v1/orders/`, () => HttpResponse.json({}, { status: 403 })),
    );
    const res = await app.inject({ method: 'GET', url: '/billing/offer' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ supporters: null, founder: null });
  });

  it('caches the answer instead of calling Polar on every request', async () => {
    let calls = 0;
    mswServer.use(
      http.get(`${POLAR}/v1/subscriptions/`, () => {
        calls++;
        return count(18);
      }),
      http.get(`${POLAR}/v1/orders/`, () => count(0)),
    );
    await app.inject({ method: 'GET', url: '/billing/offer' });
    await app.inject({ method: 'GET', url: '/billing/offer' });
    expect(calls).toBe(1);
  });
});
