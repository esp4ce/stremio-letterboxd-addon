import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { authMiddleware } from '../../../src/middleware/auth.middleware.js';
import { signUserToken } from '../../../src/lib/jwt.js';

describe('auth middleware', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();

    // Register a test route protected by the middleware
    app.get('/protected', { preHandler: authMiddleware }, async (request) => {
      return { payload: request.userPayload };
    });

    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 401 when no Authorization header', async () => {
    const res = await app.inject({ method: 'GET', url: '/protected' });

    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('Missing authorization header');
  });

  it('returns 401 when Authorization header has no Bearer prefix', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: 'Basic abc123' },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('Missing authorization header');
  });

  it('returns 401 for invalid JWT token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: 'Bearer invalid.jwt.token' },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('Invalid or expired token');
  });

  it('returns 401 for empty Bearer value', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: 'Bearer ' },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('Invalid or expired token');
  });

  it('sets userPayload on valid token', async () => {
    const token = await signUserToken({
      userId: 'user-42',
      letterboxdId: 'lbxd-42',
      username: 'testuser',
    });

    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.payload.sub).toBe('user-42');
    expect(body.payload.letterboxdId).toBe('lbxd-42');
    expect(body.payload.username).toBe('testuser');
  });
});
