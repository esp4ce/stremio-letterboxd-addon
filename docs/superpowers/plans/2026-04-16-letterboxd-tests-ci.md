# Letterboxd Module Tests + CI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Couvrir `letterboxd.service.ts` et `letterboxd.routes.ts` avec des tests unitaires/intégration, puis mettre en place un workflow CI GitHub Actions qui bloque les push sur `integration` et `main` si les tests échouent.

**Architecture:** Tests unitaires du service via vi.mock du client et de html-scraper. Tests d'intégration des routes via Fastify inject + MSW + vi.mock du service layer. Le CI utilise `secrets.GITHUB_TOKEN` comme `NPM_TOKEN` pour installer `@esp4ce/letterboxd-client` depuis GitHub Packages.

**Tech Stack:** Vitest, MSW v2, vi.mock, Fastify inject, GitHub Actions

---

## File Map

| Fichier | Action | Rôle |
|---------|--------|------|
| `backend/tests/unit/modules/letterboxd/letterboxd.service.test.ts` | Créer | Tests unitaires service : `parseLetterboxdListUrl`, `resolveFilm`, `resolveExternalList` |
| `backend/tests/integration/routes/letterboxd.test.ts` | Créer | Tests d'intégration routes : 3 endpoints avec auth + validation |
| `.github/workflows/ci.yml` | Créer | CI : tests sur push/PR vers `integration` et `main` |

---

## Task 1 : Tests unitaires de `parseLetterboxdListUrl`

**Files:**
- Create: `backend/tests/unit/modules/letterboxd/letterboxd.service.test.ts`

- [ ] **Step 1 : Créer le fichier de test avec les cas de `parseLetterboxdListUrl`**

```typescript
// backend/tests/unit/modules/letterboxd/letterboxd.service.test.ts
import { describe, it, expect } from 'vitest';
import { parseLetterboxdListUrl } from '../../../../src/modules/letterboxd/letterboxd.service.js';

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
```

- [ ] **Step 2 : Lancer les tests**

```bash
cd backend && npx vitest run tests/unit/modules/letterboxd/letterboxd.service.test.ts
```

Attendu : tous les tests passent en vert.

- [ ] **Step 3 : Commit**

```bash
git add backend/tests/unit/modules/letterboxd/letterboxd.service.test.ts
git commit -m "test: unit tests for parseLetterboxdListUrl"
```

---

## Task 2 : Tests unitaires de `resolveFilm`

**Files:**
- Modify: `backend/tests/unit/modules/letterboxd/letterboxd.service.test.ts`

- [ ] **Step 1 : Ajouter les imports et le bloc describe pour `resolveFilm`**

Ajouter après le bloc existant `parseLetterboxdListUrl` :

```typescript
import { beforeEach, vi } from 'vitest';
import { resolveFilm } from '../../../../src/modules/letterboxd/letterboxd.service.js';
import { filmCache } from '../../../../src/lib/cache.js';
import type { AuthenticatedClient } from '../../../../src/modules/letterboxd/letterboxd.client.js';

// Helper : crée un objet film minimal compatible LetterboxdFilm
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
```

- [ ] **Step 2 : Lancer les tests**

```bash
cd backend && npx vitest run tests/unit/modules/letterboxd/letterboxd.service.test.ts
```

Attendu : tous les tests passent (y compris ceux de Task 1).

- [ ] **Step 3 : Commit**

```bash
git add backend/tests/unit/modules/letterboxd/letterboxd.service.test.ts
git commit -m "test: unit tests for resolveFilm"
```

---

## Task 3 : Tests unitaires de `resolveExternalList`

**Files:**
- Modify: `backend/tests/unit/modules/letterboxd/letterboxd.service.test.ts`

- [ ] **Step 1 : Ajouter les mocks de modules en haut du fichier**

Ajouter **avant** tous les `describe`, après les imports existants :

```typescript
vi.mock('../../../../src/lib/html-scraper.js');
vi.mock('../../../../src/lib/app-client.js');
```

Ces mocks sont hoistés par Vitest — ils s'appliquent à tout le fichier.

- [ ] **Step 2 : Ajouter les imports des modules mockés**

```typescript
import * as htmlScraper from '../../../../src/lib/html-scraper.js';
import * as appClientModule from '../../../../src/lib/app-client.js';
import { resolveExternalList } from '../../../../src/modules/letterboxd/letterboxd.service.js';
```

- [ ] **Step 3 : Ajouter le bloc describe pour `resolveExternalList`**

```typescript
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
```

- [ ] **Step 4 : Lancer les tests**

```bash
cd backend && npx vitest run tests/unit/modules/letterboxd/letterboxd.service.test.ts
```

Attendu : tous les tests passent (Tasks 1+2+3).

- [ ] **Step 5 : Commit**

```bash
git add backend/tests/unit/modules/letterboxd/letterboxd.service.test.ts
git commit -m "test: unit tests for resolveExternalList"
```

---

## Task 4 : Tests d'intégration des routes letterboxd

**Files:**
- Create: `backend/tests/integration/routes/letterboxd.test.ts`

Les routes tests mockent le service layer entier (vi.mock) pour ne tester que la couche routing : auth Bearer, validation query, codes HTTP. Le flux d'auth `getClientFromToken` est mocké via `vi.mock` du module JWT et du repository.

- [ ] **Step 1 : Créer le fichier de test des routes**

```typescript
// backend/tests/integration/routes/letterboxd.test.ts
import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../../src/app.js';
import { initDb, closeDb } from '../../../src/db/index.js';
import { signUserToken } from '../../../src/lib/jwt.js';
import { createUser } from '../../../src/db/repositories/user.repository.js';
import { mswServer } from '../../helpers/msw-server.js';

// Mock le service letterboxd entier pour isoler les routes
vi.mock('../../../src/modules/letterboxd/letterboxd.service.js', () => ({
  resolveFilm: vi.fn(),
  getFilmRating: vi.fn(),
  parseLetterboxdListUrl: vi.fn(),
  resolveExternalList: vi.fn(),
}));

import * as letterboxdService from '../../../src/modules/letterboxd/letterboxd.service.js';

describe('letterboxd routes', () => {
  let app: FastifyInstance;
  let userToken: string;

  beforeAll(async () => {
    mswServer.listen({ onUnhandledRequest: 'bypass' });
    initDb();
    app = await buildApp();
    await app.ready();

    const user = createUser({
      letterboxdId: 'lbxd-routes-test',
      letterboxdUsername: 'routestestuser',
      refreshToken: 'fake-refresh-token',
    });

    userToken = await signUserToken({
      userId: user.id,
      letterboxdId: user.letterboxd_id,
      username: user.letterboxd_username,
    });
  });

  afterAll(async () => {
    mswServer.close();
    await app.close();
    closeDb();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── GET /v1/resolve-film ──────────────────────────────────────────

  describe('GET /v1/resolve-film', () => {
    it('retourne 401 sans header Authorization', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/resolve-film?title=Inception',
      });
      expect(res.statusCode).toBe(401);
    });

    it('retourne 401 avec un token invalide', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/resolve-film?title=Inception',
        headers: { authorization: 'Bearer invalid-token' },
      });
      expect(res.statusCode).toBe(401);
    });

    it('retourne 400 si aucun critère de recherche fourni', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/resolve-film',
        headers: { authorization: `Bearer ${userToken}` },
      });
      expect(res.statusCode).toBe(400);
    });

    it('retourne 404 si le film n\'est pas trouvé', async () => {
      vi.mocked(letterboxdService.resolveFilm).mockResolvedValue(null);

      const res = await app.inject({
        method: 'GET',
        url: '/v1/resolve-film?title=FilmInexistant',
        headers: { authorization: `Bearer ${userToken}` },
      });
      expect(res.statusCode).toBe(404);
    });

    it('retourne 200 avec les données du film', async () => {
      vi.mocked(letterboxdService.resolveFilm).mockResolvedValue({
        id: 'film-abc',
        name: 'Inception',
        releaseYear: 2010,
        poster: 'https://ltrbxd.com/poster.jpg',
        imdbId: 'tt1375666',
        tmdbId: '27205',
      });

      const res = await app.inject({
        method: 'GET',
        url: '/v1/resolve-film?title=Inception',
        headers: { authorization: `Bearer ${userToken}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ id: 'film-abc', name: 'Inception', imdbId: 'tt1375666' });
    });
  });

  // ── GET /v1/film-rating ───────────────────────────────────────────

  describe('GET /v1/film-rating', () => {
    it('retourne 401 sans header Authorization', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/film-rating?filmId=film-abc',
      });
      expect(res.statusCode).toBe(401);
    });

    it('retourne 400 si filmId manquant', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/film-rating',
        headers: { authorization: `Bearer ${userToken}` },
      });
      expect(res.statusCode).toBe(400);
    });

    it('retourne 200 avec les données de rating', async () => {
      vi.mocked(letterboxdService.getFilmRating).mockResolvedValue({
        rating: 4.2,
        watched: true,
        liked: true,
        inWatchlist: false,
        globalRating: 3.8,
        watchCount: 100,
      } as never);

      const res = await app.inject({
        method: 'GET',
        url: '/v1/film-rating?filmId=film-abc',
        headers: { authorization: `Bearer ${userToken}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ rating: 4.2, watched: true });
    });
  });

  // ── POST /letterboxd/resolve-list ────────────────────────────────

  describe('POST /letterboxd/resolve-list', () => {
    it('retourne 401 avec un token invalide', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/letterboxd/resolve-list',
        payload: { userToken: 'invalid', url: 'https://letterboxd.com/user/list/my-list/' },
      });
      expect(res.statusCode).toBe(401);
    });

    it('retourne 400 pour une URL non-list', async () => {
      vi.mocked(letterboxdService.parseLetterboxdListUrl).mockReturnValue(null);

      const res = await app.inject({
        method: 'POST',
        url: '/letterboxd/resolve-list',
        payload: { userToken, url: 'https://example.com/not-a-list' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('retourne 404 si la liste n\'existe pas', async () => {
      vi.mocked(letterboxdService.parseLetterboxdListUrl).mockReturnValue({
        username: 'testuser',
        slug: 'my-list',
      });
      vi.mocked(letterboxdService.resolveExternalList).mockResolvedValue(null);

      const res = await app.inject({
        method: 'POST',
        url: '/letterboxd/resolve-list',
        payload: { userToken, url: 'https://letterboxd.com/testuser/list/my-list/' },
      });
      expect(res.statusCode).toBe(404);
    });

    it('retourne 200 avec les données de la liste', async () => {
      vi.mocked(letterboxdService.parseLetterboxdListUrl).mockReturnValue({
        username: 'testuser',
        slug: 'my-cool-list',
      });
      vi.mocked(letterboxdService.resolveExternalList).mockResolvedValue({
        id: 'list-abc',
        name: 'My Cool List',
        owner: 'Test User',
        filmCount: 25,
      });

      const res = await app.inject({
        method: 'POST',
        url: '/letterboxd/resolve-list',
        payload: { userToken, url: 'https://letterboxd.com/testuser/list/my-cool-list/' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ id: 'list-abc', name: 'My Cool List', filmCount: 25 });
    });
  });
});
```

- [ ] **Step 2 : Lancer les tests**

```bash
cd backend && npx vitest run tests/integration/routes/letterboxd.test.ts
```

Attendu : tous les tests passent.

> **Si un test 401 reçoit un 500 à la place :** c'est que `getClientFromToken` lance une exception non catchée. Vérifier que `refreshAccessToken` est bien intercepté par MSW (`POST /auth/token`).

- [ ] **Step 3 : Lancer la suite complète**

```bash
cd backend && npx vitest run --coverage
```

Attendu : `letterboxd.service.ts` passe de ~2% à >70% de statements, `letterboxd.routes.ts` passe de ~32% à >80%.

- [ ] **Step 4 : Commit**

```bash
git add backend/tests/integration/routes/letterboxd.test.ts
git commit -m "test: integration tests for letterboxd routes"
```

---

## Task 5 : Workflow CI GitHub Actions

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1 : Créer le répertoire et le fichier**

```bash
mkdir -p .github/workflows
```

- [ ] **Step 2 : Écrire le workflow**

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [integration, main]
  pull_request:
    branches: [integration, main]

jobs:
  test:
    name: Tests backend
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: backend/package-lock.json

      - name: Install dependencies
        working-directory: backend
        run: npm ci
        env:
          NPM_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      - name: Run tests
        working-directory: backend
        run: npm run test:run
```

> **Note :** Le `.npmrc` dans `backend/` utilise `${NPM_TOKEN}`. `secrets.GITHUB_TOKEN` est automatiquement disponible dans toute GitHub Action — aucun secret à configurer manuellement. Il suffit que le package `@esp4ce/letterboxd-client` soit lisible par le token du repo (même organisation `esp4ce`).

- [ ] **Step 3 : Commit et push**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add GitHub Actions workflow for integration and main branches"
git push origin integration
```

- [ ] **Step 4 : Vérifier que le workflow se déclenche**

Aller sur `github.com/esp4ce/stremio-letterboxd-addon/actions` et confirmer que le job `Tests backend` démarre et passe au vert.

---

## Self-Review

### Couverture de spec
- ✅ Tests unitaires `parseLetterboxdListUrl` (7 cas)
- ✅ Tests unitaires `resolveFilm` (7 cas : null, first result, year match, imdbId match, tmdbId match, cache, poster)
- ✅ Tests unitaires `resolveExternalList` (6 cas : stratégie 1, fallbacks, null member, null slug, API error)
- ✅ Tests routes `GET /v1/resolve-film` (5 cas)
- ✅ Tests routes `GET /v1/film-rating` (3 cas)
- ✅ Tests routes `POST /letterboxd/resolve-list` (4 cas)
- ✅ CI workflow déclenché sur push + PR vers `integration` et `main`

### Cohérence des types
- `resolveFilm` retourne `ResolvedFilm | null` = `CachedFilm | null` → mock cohérent
- `getFilmRating` retourne `FilmRating` = `CachedRating` → mock avec `as never` pour éviter d'importer le type complet
- `parseLetterboxdListUrl` retourne `ParsedListUrl | null` → mock cohérent
- `resolveExternalList` retourne `ResolvedExternalList | null` → mock cohérent

### Placeholders
Aucun TBD ou TODO dans le plan.
