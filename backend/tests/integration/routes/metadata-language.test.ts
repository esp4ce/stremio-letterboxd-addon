import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { http, HttpResponse } from 'msw';
import { mswServer, makeWatchlistFilm } from '../../helpers/msw-server.js';

vi.mock('../../../src/config/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/config/index.js')>();
  return { ...actual, tmdbConfig: { apiKey: 'test-api-key' } };
});

const getEntitlement = vi.fn<(userId: string) => Promise<boolean>>();
vi.mock('../../../src/modules/billing/billing.service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/modules/billing/billing.service.js')>();
  return { ...actual, getEntitlement: (userId: string) => getEntitlement(userId) };
});

import { configure } from '@esp4ce/letterboxd-client';
import { buildApp } from '../../../src/app.js';
import { initDb, closeDb } from '../../../src/db/index.js';
import { createUser, findUserById, getUserPreferences, updateUserPreferences } from '../../../src/db/repositories/user.repository.js';
import { allCaches } from '../../../src/lib/cache.js';
import { catalogConfig } from '../../../src/config/index.js';

const TMDB = 'https://api.themoviedb.org/3';
const CINEMETA = 'https://v3-cinemeta.strem.io/meta/movie/:id.json';

const base = {
  catalogs: { watchlist: false, diary: false, friends: false, popular: true, top250: false, likedFilms: false, recommended: false },
  ownLists: [],
  externalLists: [],
};

const jaws = makeWatchlistFilm({
  id: 'jaws',
  name: 'Jaws',
  links: [{ type: 'imdb', id: 'tt0073195', url: 'https://imdb.com/title/tt0073195' }],
});

describe('Metadata Language on account catalogs', () => {
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

  beforeEach(() => {
    for (const { cache } of allCaches) cache.clear();
    getEntitlement.mockReset();
    mswServer.use(
      http.all('*/auth/token', () =>
        HttpResponse.json({ access_token: 'test-access-token', token_type: 'Bearer', expires_in: 3600, refresh_token: 'test-refresh-token' }),
      ),
      http.get('*/films', () => HttpResponse.json({ items: [jaws] })),
      http.get(CINEMETA, () =>
        HttpResponse.json({ meta: { name: 'Jaws', description: 'An English synopsis.' } }),
      ),
      http.get(`${TMDB}/find/:externalId`, ({ request }) => {
        const language = new URL(request.url).searchParams.get('language');
        if (language !== 'fr-FR') return HttpResponse.json({ movie_results: [{ id: 578 }] });
        return HttpResponse.json({
          movie_results: [{
            id: 578,
            title: 'Les Dents de la Mer',
            original_title: 'Jaws',
            original_language: 'en',
            overview: 'Un synopsis en français.',
          }],
        });
      }),
    );
  });

  afterEach(() => mswServer.resetHandlers());

  async function popularFor(preferences: Record<string, unknown>, entitled: boolean) {
    const user = createUser({ letterboxdId: `lb-${Math.random()}`, letterboxdUsername: 'ml', refreshToken: 'fake' });
    updateUserPreferences(user.id, { ...base, ...preferences } as never);
    getEntitlement.mockResolvedValue(entitled);
    const res = await app.inject({ method: 'GET', url: `/stremio/${user.id}/catalog/movie/letterboxd-popular.json` });
    return res.json() as { metas: Array<{ id: string; name: string; description?: string }> };
  }

  it('shows a Supporter titles and synopses in their Metadata Language', async () => {
    const body = await popularFor({ metadataLanguage: 'fr-FR' }, true);

    expect(body.metas[0]).toMatchObject({
      id: 'tt0073195',
      name: 'Les Dents de la Mer',
      description: 'Un synopsis en français.',
    });
  });

  it('shows English to a member who is no longer a Supporter, keeping their choice', async () => {
    const user = createUser({ letterboxdId: `lb-${Math.random()}`, letterboxdUsername: 'ml', refreshToken: 'fake' });
    updateUserPreferences(user.id, { ...base, metadataLanguage: 'fr-FR' } as never);
    getEntitlement.mockResolvedValue(false);

    const res = await app.inject({ method: 'GET', url: `/stremio/${user.id}/catalog/movie/letterboxd-popular.json` });

    expect(res.json().metas[0]).toMatchObject({ name: 'Jaws', description: 'An English synopsis.' });
    expect(getUserPreferences(findUserById(user.id)!)?.metadataLanguage).toBe('fr-FR');
  });

  function tmdbReturns(movie: Record<string, string>) {
    mswServer.use(
      http.get(`${TMDB}/find/:externalId`, () => HttpResponse.json({ movie_results: [{ id: 578, ...movie }] })),
    );
  }

  it('keeps the English synopsis when none exists in the Metadata Language', async () => {
    tmdbReturns({ title: 'Tiburón', original_title: 'Jaws', original_language: 'en', overview: '' });

    const body = await popularFor({ metadataLanguage: 'es-MX' }, true);

    expect(body.metas[0]).toMatchObject({ name: 'Tiburón', description: 'An English synopsis.' });
  });

  it('keeps the English title when the translation falls back to a foreign original title', async () => {
    tmdbReturns({ title: 'タンポポ', original_title: 'タンポポ', original_language: 'ja', overview: 'Una sinopsis.' });

    const body = await popularFor({ metadataLanguage: 'es-MX' }, true);

    expect(body.metas[0]).toMatchObject({ name: 'Jaws', description: 'Una sinopsis.' });
  });

  it('shows the original title when the film was made in the Metadata Language', async () => {
    tmdbReturns({ title: 'Les Quatre Cents Coups', original_title: 'Les Quatre Cents Coups', original_language: 'fr', overview: 'Antoine.' });

    const body = await popularFor({ metadataLanguage: 'fr-FR' }, true);

    expect(body.metas[0]!.name).toBe('Les Quatre Cents Coups');
  });

  async function catalogFor(catalogId: string, preferences: Record<string, unknown>) {
    const user = createUser({ letterboxdId: `lb-${Math.random()}`, letterboxdUsername: 'ml', refreshToken: 'fake' });
    updateUserPreferences(user.id, { ...base, ...preferences } as never);
    getEntitlement.mockResolvedValue(true);
    const res = await app.inject({ method: 'GET', url: `/stremio/${user.id}/catalog/movie/${catalogId}.json` });
    return res.json() as { metas: Array<{ id: string; name: string; description?: string }> };
  }

  it('keeps the rank after the translated synopsis in a ranked list', async () => {
    mswServer.use(
      http.get('*/list/:id/entries', () => HttpResponse.json({ items: [{ rank: 12, film: jaws }] })),
    );

    const body = await catalogFor('letterboxd-list-ranked', { metadataLanguage: 'fr-FR' });

    expect(body.metas[0]).toMatchObject({
      name: 'Les Dents de la Mer',
      description: 'Un synopsis en français.\n\n#12',
    });
  });

  it('never replaces the diary line Stremboxd writes for an entry', async () => {
    mswServer.use(
      http.get('*/me', () => HttpResponse.json({ member: { id: 'member-1', username: 'ml', displayName: 'ML' } })),
      http.get('*/log-entries', () =>
        HttpResponse.json({ items: [{ id: 'log-1', diaryDate: '2024-01-15', rating: 4, like: true, film: jaws }] }),
      ),
    );

    const body = await catalogFor('letterboxd-diary', { metadataLanguage: 'fr-FR', catalogs: { ...base.catalogs, diary: true } });

    expect(body.metas[0]!.name).toBe('Les Dents de la Mer');
    expect(body.metas[0]!.description).toContain('Liked');
    expect(body.metas[0]!.description).not.toContain('Un synopsis en français.');
  });

  it('serves English to the next member after a Supporter was served French', async () => {
    await popularFor({ metadataLanguage: 'fr-FR' }, true);

    const body = await popularFor({}, false);

    expect(body.metas[0]).toMatchObject({ name: 'Jaws', description: 'An English synopsis.' });
  });

  it('asks TMDB once per film and language', async () => {
    let calls = 0;
    mswServer.use(
      http.get(`${TMDB}/find/:externalId`, () => {
        calls++;
        return HttpResponse.json({
          movie_results: [{ id: 578, title: 'Lo squalo', original_title: 'Jaws', original_language: 'en', overview: 'Una sinossi.' }],
        });
      }),
    );

    await popularFor({ metadataLanguage: 'it-IT' }, true);
    const body = await popularFor({ metadataLanguage: 'it-IT' }, true);

    expect(body.metas[0]!.name).toBe('Lo squalo');
    expect(calls).toBe(1);
  });

  it('falls back to English when TMDB fails', async () => {
    mswServer.use(http.get(`${TMDB}/find/:externalId`, () => new HttpResponse(null, { status: 500 })));

    const body = await popularFor({ metadataLanguage: 'fr-FR' }, true);

    expect(body.metas[0]).toMatchObject({ name: 'Jaws', description: 'An English synopsis.' });
  });

  it.each(['en-US', 'ar-SA'])('asks neither Polar nor TMDB for %s', async (metadataLanguage) => {
    let calls = 0;
    mswServer.use(
      http.get(`${TMDB}/find/:externalId`, () => {
        calls++;
        return HttpResponse.json({ movie_results: [] });
      }),
    );

    const body = await popularFor({ metadataLanguage }, true);

    expect(body.metas[0]!.name).toBe('Jaws');
    expect(calls).toBe(0);
    expect(getEntitlement).not.toHaveBeenCalled();
  });

  it('shows search results to a Supporter in their Metadata Language', async () => {
    mswServer.use(
      http.get('*/search', () =>
        HttpResponse.json({ items: [{ type: 'FilmSearchItem', film: { ...jaws, description: 'A Letterboxd synopsis.' } }] }),
      ),
    );

    const body = await catalogFor('letterboxd-search/search=jaws', { metadataLanguage: 'fr-FR' });

    expect(body.metas[0]).toMatchObject({ name: 'Les Dents de la Mer', description: 'Un synopsis en français.' });
  });

  it('keeps search results untouched for a member who is not a Supporter', async () => {
    mswServer.use(
      http.get('*/search', () =>
        HttpResponse.json({ items: [{ type: 'FilmSearchItem', film: { ...jaws, description: 'A Letterboxd synopsis.' } }] }),
      ),
    );
    getEntitlement.mockResolvedValue(false);
    const user = createUser({ letterboxdId: `lb-${Math.random()}`, letterboxdUsername: 'ml', refreshToken: 'fake' });
    updateUserPreferences(user.id, { ...base, metadataLanguage: 'fr-FR' } as never);

    const res = await app.inject({ method: 'GET', url: `/stremio/${user.id}/catalog/movie/letterboxd-search/search=jaws.json` });

    expect(res.json().metas[0]).toMatchObject({ name: 'Jaws', description: 'A Letterboxd synopsis.' });
  });

  async function filmPageFor(preferences: Record<string, unknown>, entitled: boolean) {
    const user = createUser({ letterboxdId: `lb-${Math.random()}`, letterboxdUsername: 'ml', refreshToken: 'fake' });
    updateUserPreferences(user.id, { ...base, ...preferences } as never);
    getEntitlement.mockResolvedValue(entitled);
    const res = await app.inject({ method: 'GET', url: `/stremio/${user.id}/meta/movie/tt0073195.json` });
    return res.json() as { meta: { name: string; description?: string; logo?: string } };
  }

  it('shows a Supporter the film page in their Metadata Language', async () => {
    const body = await filmPageFor({ metadataLanguage: 'fr-FR' }, true);

    expect(body.meta).toMatchObject({ name: 'Les Dents de la Mer', description: 'Un synopsis en français.' });
  });

  function cinemetaWithLogo() {
    mswServer.use(
      http.get(CINEMETA, () =>
        HttpResponse.json({ meta: { name: 'Jaws', description: 'An English synopsis.', logo: 'https://images.example/en-logo.png' } }),
      ),
    );
  }

  it('shows the film page logo in the Metadata Language when TMDB has one', async () => {
    cinemetaWithLogo();
    mswServer.use(
      http.get(`${TMDB}/movie/:id/images`, ({ request, params }) => {
        const language = new URL(request.url).searchParams.get('include_image_language');
        expect(params['id']).toBe('578');
        return HttpResponse.json({ logos: language === 'fr' ? [{ iso_639_1: 'fr', file_path: '/fr-logo.png' }] : [] });
      }),
    );

    const body = await filmPageFor({ metadataLanguage: 'fr-FR' }, true);

    expect(body.meta).toMatchObject({ name: 'Les Dents de la Mer', logo: 'https://image.tmdb.org/t/p/w500/fr-logo.png' });
  });

  it('drops the English logo so the translated title shows when no localized logo exists', async () => {
    cinemetaWithLogo();
    mswServer.use(http.get(`${TMDB}/movie/:id/images`, () => HttpResponse.json({ logos: [] })));

    const body = await filmPageFor({ metadataLanguage: 'fr-FR' }, true);

    expect(body.meta.name).toBe('Les Dents de la Mer');
    expect(body.meta).not.toHaveProperty('logo');
  });

  it('keeps the English logo when the title itself stays English', async () => {
    cinemetaWithLogo();
    tmdbReturns({ title: 'タンポポ', original_title: 'タンポポ', original_language: 'ja', overview: 'Una sinopsis.' });
    mswServer.use(http.get(`${TMDB}/movie/:id/images`, () => HttpResponse.json({ logos: [] })));

    const body = await filmPageFor({ metadataLanguage: 'es-MX' }, true);

    expect(body.meta).toMatchObject({ name: 'Jaws', logo: 'https://images.example/en-logo.png' });
  });

  it('keeps the film page in English for a member who is not a Supporter', async () => {
    const body = await filmPageFor({ metadataLanguage: 'fr-FR' }, false);

    expect(body.meta).toMatchObject({ name: 'Jaws', description: 'An English synopsis.' });
  });
});
