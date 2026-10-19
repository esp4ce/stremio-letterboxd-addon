import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { http, HttpResponse } from 'msw';
import { mswServer, makeList } from '../../helpers/msw-server.js';

// Letterboxd's HTML pages are unreachable from production (Cloudflare), so the
// route must not depend on them.
vi.mock('../../../src/lib/html-scraper.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/lib/html-scraper.js')>();
  return { ...actual, fetchPageHtml: vi.fn().mockResolvedValue(null) };
});

import { configure } from '@esp4ce/letterboxd-client';
import { buildApp } from '../../../src/app.js';
import { initDb, closeDb } from '../../../src/db/index.js';
import { catalogConfig } from '../../../src/config/index.js';

describe('POST /auth/resolve-list-public', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    configure({ clientId: catalogConfig.clientId, clientSecret: catalogConfig.clientSecret, userAgent: catalogConfig.userAgent });
    mswServer.listen({ onUnhandledRequest: 'error' });
    initDb();
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    closeDb();
    mswServer.close();
  });

  it('résout une liste au titre sans lettres latines via son slug filmlist:<n> (#158)', async () => {
    mswServer.use(
      http.all('*/auth/token', () =>
        HttpResponse.json({ access_token: 'test-access-token', token_type: 'Bearer', expires_in: 3600, refresh_token: 'test-refresh-token' }),
      ),
      http.get('*/list/:id', ({ params }) =>
        params['id'] === 'jq61y'
          ? HttpResponse.json(makeList({ id: 'jq61y', name: '🐉🎭✨ 𝕍𝕀𝕊𝕌𝔸𝕃𝕃𝕐 𝙸𝙽𝚂𝙰𝙽𝙴👹', filmCount: 833 }))
          : HttpResponse.json({}, { status: 404 }),
      ),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/auth/resolve-list-public',
      payload: { url: 'https://letterboxd.com/etolkin/list/filmlist:28697007/' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: 'jq61y', filmCount: 833 });
  });
});
