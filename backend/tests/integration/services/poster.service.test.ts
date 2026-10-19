import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import sharp from 'sharp';
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

  describe('allowed poster hosts (Cinemeta and TMDB)', () => {
    const server = setupServer();
    let jpeg: Buffer;

    beforeAll(async () => {
      jpeg = await sharp({
        create: { width: 20, height: 30, channels: 3, background: '#336699' },
      })
        .jpeg()
        .toBuffer();
      server.listen({ onUnhandledFrame: 'bypass' });
    });

    afterAll(() => server.close());
    afterEach(() => server.resetHandlers());

    it('serves a poster from images.metahub.space (Cinemeta poster host)', async () => {
      server.use(
        http.get('https://images.metahub.space/poster/small/tt0111161/img', () =>
          HttpResponse.arrayBuffer(new Uint8Array(jpeg).buffer, {
            headers: { 'Content-Type': 'image/jpeg' },
          }),
        ),
      );
      const res = await app.inject({
        method: 'GET',
        url: `/poster?url=${encodeURIComponent('https://images.metahub.space/poster/small/tt0111161/img')}&rating=4.5`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('image/jpeg');
    });

    it('serves a poster from image.tmdb.org (previously a 500)', async () => {
      server.use(
        http.get('https://image.tmdb.org/t/p/w500/abc.jpg', () =>
          HttpResponse.arrayBuffer(new Uint8Array(jpeg).buffer, {
            headers: { 'Content-Type': 'image/jpeg' },
          }),
        ),
      );
      const res = await app.inject({
        method: 'GET',
        url: `/poster?url=${encodeURIComponent('https://image.tmdb.org/t/p/w500/abc.jpg')}&rating=4.3`,
      });

      expect(res.statusCode).toBe(200);
    });

    describe('friend attribution badge (by)', () => {
      const POSTER = 'https://image.tmdb.org/t/p/w500/friend-badge.jpg';
      let bigJpeg: Buffer;

      beforeAll(async () => {
        bigJpeg = await sharp({
          create: { width: 300, height: 450, channels: 3, background: '#336699' },
        })
          .jpeg()
          .toBuffer();
      });

      const serve = () =>
        server.use(
          http.get(POSTER, () =>
            HttpResponse.arrayBuffer(new Uint8Array(bigJpeg).buffer, {
              headers: { 'Content-Type': 'image/jpeg' },
            }),
          ),
        );
      const get = (query: string) =>
        app.inject({ method: 'GET', url: `/poster?url=${encodeURIComponent(POSTER)}&${query}` });

      it('serves a poster with only a friend name (no community rating)', async () => {
        serve();
        const res = await get('by=Joel');
        expect(res.statusCode).toBe(200);
        expect(res.headers['content-type']).toContain('image/jpeg');
      });

      it('draws the friend badge: result differs from the rating-only poster', async () => {
        serve();
        const plain = await get('rating=4.0');
        const withFriend = await get(`rating=4.0&by=${encodeURIComponent('Joel Haver')}`);
        expect(withFriend.statusCode).toBe(200);
        expect(withFriend.rawPayload.equals(plain.rawPayload)).toBe(false);
      });

      it('does not serve one friend\'s poster to another (cache key includes by)', async () => {
        serve();
        const a = await get('rating=3.0&by=Alice');
        const b = await get('rating=3.0&by=Bob');
        expect(a.statusCode).toBe(200);
        expect(b.statusCode).toBe(200);
        expect(a.rawPayload.equals(b.rawPayload)).toBe(false);
      });

      it('survives markup and unrenderable characters in the name', async () => {
        serve();
        const res = await get(`rating=2.0&by=${encodeURIComponent('<svg onload=x>"&日本語')}`);
        expect(res.statusCode).toBe(200);
      });

      it('still requires a rating or a friend', async () => {
        const res = await get('x=1');
        expect(res.statusCode).toBe(400);
      });
    });

    it('still rejects lookalike hosts', async () => {
      for (const u of [
        'https://images.metahub.space.evil.com/x',
        'https://evilimages.metahub.space/x',
        'https://metahub.space/x',
      ]) {
        const res = await app.inject({
          method: 'GET',
          url: `/poster?url=${encodeURIComponent(u)}&rating=4.0`,
        });
        expect(res.statusCode).toBe(400);
      }
    });
  });
});
