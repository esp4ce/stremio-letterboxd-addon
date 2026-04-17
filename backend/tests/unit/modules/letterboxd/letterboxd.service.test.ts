import { describe, it, expect, beforeEach, vi } from 'vitest';
import { parseLetterboxdListUrl, resolveFilm, resolveExternalList } from '../../../../src/modules/letterboxd/letterboxd.service.js';
import { filmCache } from '../../../../src/lib/cache.js';
import type { AuthenticatedClient } from '../../../../src/modules/letterboxd/letterboxd.client.js';
import * as htmlScraper from '../../../../src/lib/html-scraper.js';
import * as appClientModule from '../../../../src/lib/app-client.js';

vi.mock('../../../../src/lib/html-scraper.js');
vi.mock('../../../../src/lib/app-client.js');

function makeFilm(overrides: Record<string, unknown> = {}) {
  return {
    id: 'film-1',
    name: 'Test Film',
    releaseYear: 2024,
    poster: { sizes: [{ width: 300, url: 'https://ltrbxd.com/poster.jpg' }] },
    links: [{ type: 'imdb', id: 'tt1234567' }],
    ...overrides,
  };
}

describe('parseLetterboxdListUrl', () => {
  it('parse une URL complète avec trailing slash', () => {
    const result = parseLetterboxdListUrl('https://letterboxd.com/testuser/list/my-cool-list/');
    expect(result).toEqual({ username: 'testuser', slug: 'my-cool-list' });
  });

  it('parse une URL sans trailing slash', () => {
    const result = parseLetterboxdListUrl('https://letterboxd.com/testuser/list/my-cool-list');
    expect(result).toEqual({ username: 'testuser', slug: 'my-cool-list' });
  });

  it('parse une URL sans protocole', () => {
    const result = parseLetterboxdListUrl('letterboxd.com/testuser/list/my-list/');
    expect(result).toEqual({ username: 'testuser', slug: 'my-list' });
  });

  it('parse une URL avec www', () => {
    const result = parseLetterboxdListUrl('https://www.letterboxd.com/testuser/list/my-list/');
    expect(result).toEqual({ username: 'testuser', slug: 'my-list' });
  });

  it('retourne null pour une URL non-list', () => {
    expect(parseLetterboxdListUrl('https://letterboxd.com/testuser/films/')).toBeNull();
  });

  it('retourne null pour une chaîne vide', () => {
    expect(parseLetterboxdListUrl('')).toBeNull();
  });

  it('retourne null pour une URL aléatoire', () => {
    expect(parseLetterboxdListUrl('https://example.com/foo/bar')).toBeNull();
  });
});

describe('resolveFilm', () => {
  const mockClient = {
    searchFilms: vi.fn(),
  } as unknown as AuthenticatedClient;

  beforeEach(() => {
    vi.clearAllMocks();
    filmCache.clear();
  });

  it('retourne null si aucun résultat', async () => {
    mockClient.searchFilms = vi.fn().mockResolvedValue({ items: [] });
    const result = await resolveFilm(mockClient, { title: 'Film Inexistant' });
    expect(result).toBeNull();
  });

  it('retourne le premier résultat si aucun match précis', async () => {
    mockClient.searchFilms = vi.fn().mockResolvedValue({ items: [makeFilm()] });
    const result = await resolveFilm(mockClient, { title: 'Test Film' });
    expect(result).toMatchObject({ id: 'film-1', name: 'Test Film', imdbId: 'tt1234567' });
  });

  it('préfère le film dont l\'année correspond exactement', async () => {
    const film2022 = makeFilm({ id: 'old', releaseYear: 2022, links: [] });
    const film2024 = makeFilm({ id: 'new', releaseYear: 2024, links: [{ type: 'imdb', id: 'tt9999999' }] });
    mockClient.searchFilms = vi.fn().mockResolvedValue({ items: [film2022, film2024] });

    const result = await resolveFilm(mockClient, { title: 'Test Film', year: 2024 });
    expect(result?.id).toBe('new');
  });

  it('préfère le film dont l\'imdbId correspond', async () => {
    const film1 = makeFilm({ id: 'f1', links: [{ type: 'imdb', id: 'tt0000001' }] });
    const film2 = makeFilm({ id: 'f2', links: [{ type: 'imdb', id: 'tt9999999' }] });
    mockClient.searchFilms = vi.fn().mockResolvedValue({ items: [film1, film2] });

    const result = await resolveFilm(mockClient, { title: 'Test Film', imdbId: 'tt9999999' });
    expect(result?.id).toBe('f2');
  });

  it('préfère le film dont le tmdbId correspond', async () => {
    const film1 = makeFilm({ id: 'f1', links: [{ type: 'imdb', id: 'tt0000001' }] });
    const film2 = makeFilm({ id: 'f2', links: [{ type: 'tmdb', id: '12345' }] });
    mockClient.searchFilms = vi.fn().mockResolvedValue({ items: [film1, film2] });

    const result = await resolveFilm(mockClient, { title: 'Test Film', tmdbId: '12345' });
    expect(result?.id).toBe('f2');
  });

  it('sert le résultat depuis le cache au deuxième appel', async () => {
    mockClient.searchFilms = vi.fn().mockResolvedValue({ items: [makeFilm()] });

    await resolveFilm(mockClient, { title: 'Test Film' });
    await resolveFilm(mockClient, { title: 'Test Film' });

    expect(mockClient.searchFilms).toHaveBeenCalledTimes(1);
  });

  it('sélectionne le poster de plus haute résolution', async () => {
    const film = makeFilm({
      poster: {
        sizes: [
          { width: 150, url: 'https://ltrbxd.com/small.jpg' },
          { width: 500, url: 'https://ltrbxd.com/large.jpg' },
          { width: 300, url: 'https://ltrbxd.com/medium.jpg' },
        ],
      },
    });
    mockClient.searchFilms = vi.fn().mockResolvedValue({ items: [film] });

    const result = await resolveFilm(mockClient, { title: 'Test Film' });
    expect(result?.poster).toBe('https://ltrbxd.com/large.jpg');
  });

  it('retourne undefined pour poster si aucune taille disponible', async () => {
    const film = makeFilm({ poster: { sizes: [] } });
    mockClient.searchFilms = vi.fn().mockResolvedValue({ items: [film] });

    const result = await resolveFilm(mockClient, { title: 'Test Film' });
    expect(result?.poster).toBeUndefined();
  });
});

describe('resolveExternalList', () => {
  const mockClient = {
    searchMemberByUsername: vi.fn(),
    searchLists: vi.fn(),
  } as unknown as AuthenticatedClient;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stratégie 1 : résout la liste via le scraping HTML', async () => {
    vi.mocked(htmlScraper.fetchPageHtml).mockResolvedValue('<html>shortlink page</html>');
    vi.mocked(htmlScraper.extractListIdFromListPage).mockReturnValue('list-abc');
    vi.mocked(appClientModule.callWithAppToken).mockResolvedValue({
      id: 'list-abc',
      name: 'My Curated List',
      filmCount: 42,
      owner: { displayName: 'Test User', username: 'testuser' },
    });

    const result = await resolveExternalList(mockClient, 'testuser', 'my-curated-list');

    expect(result).toEqual({
      id: 'list-abc',
      name: 'My Curated List',
      filmCount: 42,
      owner: 'Test User',
    });
    expect(mockClient.searchMemberByUsername).not.toHaveBeenCalled();
  });

  it('stratégie 1 fallback : pas d\'ID dans le HTML, passe à la stratégie 2', async () => {
    vi.mocked(htmlScraper.fetchPageHtml).mockResolvedValue('<html>no list id here</html>');
    vi.mocked(htmlScraper.extractListIdFromListPage).mockReturnValue(null);
    mockClient.searchMemberByUsername = vi.fn().mockResolvedValue({
      id: 'member-1',
      username: 'testuser',
      displayName: 'Test User',
    });
    mockClient.searchLists = vi.fn().mockResolvedValue({
      items: [{ id: 'list-456', name: 'My Curated List', filmCount: 10 }],
      cursor: undefined,
    });

    const result = await resolveExternalList(mockClient, 'testuser', 'my-curated-list');

    expect(result).toMatchObject({ id: 'list-456', name: 'My Curated List', filmCount: 10 });
  });

  it('stratégie 1 fallback : HTML indisponible, passe à la stratégie 2', async () => {
    vi.mocked(htmlScraper.fetchPageHtml).mockResolvedValue(null);
    mockClient.searchMemberByUsername = vi.fn().mockResolvedValue({
      id: 'member-1',
      username: 'testuser',
      displayName: 'Test User',
    });
    mockClient.searchLists = vi.fn().mockResolvedValue({
      items: [{ id: 'list-789', name: 'Another List', filmCount: 5 }],
      cursor: undefined,
    });

    const result = await resolveExternalList(mockClient, 'testuser', 'another-list');
    expect(result).toMatchObject({ id: 'list-789' });
  });

  it('retourne null si le membre n\'existe pas (stratégie 2)', async () => {
    vi.mocked(htmlScraper.fetchPageHtml).mockResolvedValue(null);
    mockClient.searchMemberByUsername = vi.fn().mockResolvedValue(null);

    const result = await resolveExternalList(mockClient, 'ghost', 'some-list');
    expect(result).toBeNull();
  });

  it('retourne null si la liste n\'est pas trouvée par slug (stratégie 2)', async () => {
    vi.mocked(htmlScraper.fetchPageHtml).mockResolvedValue(null);
    mockClient.searchMemberByUsername = vi.fn().mockResolvedValue({
      id: 'member-1',
      username: 'testuser',
      displayName: 'Test User',
    });
    mockClient.searchLists = vi.fn().mockResolvedValue({
      items: [{ id: 'l1', name: 'Unrelated List', filmCount: 3 }],
      cursor: undefined,
    });

    const result = await resolveExternalList(mockClient, 'testuser', 'nonexistent-slug');
    expect(result).toBeNull();
  });

  it('stratégie 1 : API échoue après extraction de l\'ID, passe à la stratégie 2', async () => {
    vi.mocked(htmlScraper.fetchPageHtml).mockResolvedValue('<html>page</html>');
    vi.mocked(htmlScraper.extractListIdFromListPage).mockReturnValue('bad-id');
    vi.mocked(appClientModule.callWithAppToken).mockRejectedValue(new Error('API error'));
    mockClient.searchMemberByUsername = vi.fn().mockResolvedValue({
      id: 'member-1',
      username: 'testuser',
      displayName: 'Test User',
    });
    mockClient.searchLists = vi.fn().mockResolvedValue({
      items: [{ id: 'list-fallback', name: 'My Curated List', filmCount: 7 }],
      cursor: undefined,
    });

    const result = await resolveExternalList(mockClient, 'testuser', 'my-curated-list');
    expect(result?.id).toBe('list-fallback');
  });
});
