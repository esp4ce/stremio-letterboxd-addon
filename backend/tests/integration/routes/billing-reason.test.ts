import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../../src/app.js';
import { initDb, closeDb, getDb } from '../../../src/db/index.js';
import { createUser } from '../../../src/db/repositories/user.repository.js';
import { signUserToken } from '../../../src/lib/jwt.js';

async function bearerFor(letterboxdId: string) {
  const user = createUser({ letterboxdId, letterboxdUsername: letterboxdId, refreshToken: 'x' });
  const token = await signUserToken({ userId: user.id, letterboxdId: user.letterboxd_id, username: user.letterboxd_username });
  return { user, headers: { authorization: `Bearer ${token}` } };
}

describe('POST /billing/reason', () => {
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

  it('returns 401 without a session', async () => {
    const res = await app.inject({ method: 'POST', url: '/billing/reason', payload: { reason: 'auto_log' } });
    expect(res.statusCode).toBe(401);
  });

  it('rejects an unknown reason', async () => {
    const { headers } = await bearerFor('reason-bad');
    const res = await app.inject({ method: 'POST', url: '/billing/reason', headers, payload: { reason: 'free text' } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Invalid reason' });
  });

  it('rejects a missing body', async () => {
    const { headers } = await bearerFor('reason-empty');
    const res = await app.inject({ method: 'POST', url: '/billing/reason', headers });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Invalid reason' });
  });

  it('records the reason anonymously and answers 204', async () => {
    const { user, headers } = await bearerFor('reason-ok');
    const res = await app.inject({ method: 'POST', url: '/billing/reason', headers, payload: { reason: 'auto_sync' } });

    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');

    const rows = getDb()
      .prepare("SELECT user_id, anonymous_id, metadata FROM events WHERE event = 'supporter_reason'")
      .all() as Array<{ user_id: string | null; anonymous_id: string | null; metadata: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.user_id).toBeNull();
    expect(JSON.parse(rows[0]!.metadata)).toEqual({ reason: 'auto_sync' });
    expect(JSON.stringify(rows)).not.toContain(user.id);
  });
});
