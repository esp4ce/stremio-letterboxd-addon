import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';

const API = 'https://api.letterboxd.com/api/v0';
const TMDB = 'https://api.themoviedb.org/3';

// ── Fixture factories ──────────────────────────────────────────────

export function makeFilm(overrides: Record<string, unknown> = {}) {
  return {
    id: 'abc123',
    name: 'Test Film',
    releaseYear: 2024,
    poster: { sizes: [{ width: 230, height: 345, url: 'https://ltrbxd.com/poster.jpg' }] },
    links: [{ type: 'imdb', id: 'tt1234567', url: 'https://imdb.com/title/tt1234567' }],
    genres: [{ id: 'action', name: 'Action' }],
    contributions: [{ type: 'Director', contributors: [{ id: 'd1', name: 'Test Director' }] }],
    ...overrides,
  };
}

export function makeWatchlistFilm(overrides: Record<string, unknown> = {}) {
  return {
    type: 'FilmSummary',
    id: 'wf1',
    name: 'Watchlist Film',
    releaseYear: 2024,
    poster: { sizes: [{ width: 230, height: 345, url: 'https://ltrbxd.com/poster.jpg' }] },
    directors: [{ id: 'd1', name: 'Test Director' }],
    genres: [{ id: 'drama', name: 'Drama' }],
    links: [{ type: 'imdb', id: 'tt0000001', url: 'https://imdb.com/title/tt0000001' }],
    ...overrides,
  };
}

export function makeMember(overrides: Record<string, unknown> = {}) {
  return {
    id: 'member-1',
    username: 'testuser',
    displayName: 'Test User',
    ...overrides,
  };
}

export function makeList(overrides: Record<string, unknown> = {}) {
  return {
    id: 'list-1',
    name: 'Test List',
    filmCount: 10,
    owner: makeMember(),
    ...overrides,
  };
}

export function makeLogEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: 'log-1',
    diaryDate: '2024-01-15',
    rating: 4,
    like: true,
    film: makeWatchlistFilm(),
    owner: makeMember(),
    ...overrides,
  };
}

// ── Default handlers ────────────────────────────────────────────────

export const defaultHandlers = [
  // Auth: app token
  http.post(`${API}/auth/token`, () =>
    HttpResponse.json({
      access_token: 'test-access-token',
      token_type: 'Bearer',
      expires_in: 3600,
      refresh_token: 'test-refresh-token',
    }),
  ),

  // Auth: current user
  http.get(`${API}/me`, () =>
    HttpResponse.json({
      member: makeMember(),
    }),
  ),

  // Films: popular
  http.get(`${API}/films`, () =>
    HttpResponse.json({
      items: [makeWatchlistFilm({ id: 'pop1', name: 'Popular 1' }), makeWatchlistFilm({ id: 'pop2', name: 'Popular 2' })],
    }),
  ),

  // Film by ID
  http.get(`${API}/film/:id`, ({ params }) =>
    HttpResponse.json(makeFilm({ id: params['id'] })),
  ),

  // Film relationship
  http.get(`${API}/film/:id/me`, () =>
    HttpResponse.json({ watched: false, liked: false, inWatchlist: false }),
  ),

  // Film statistics
  http.get(`${API}/film/:id/statistics`, ({ params }) =>
    HttpResponse.json({
      film: { id: params['id'], name: 'Test Film' },
      counts: { watches: 100, likes: 50, ratings: 80, fans: 10, lists: 5, reviews: 20 },
      rating: 3.8,
    }),
  ),

  // Update film relationship
  http.patch(`${API}/film/:id/me`, () =>
    HttpResponse.json({
      data: { watched: true, liked: false, inWatchlist: false },
      messages: [],
    }),
  ),

  // Watchlist
  http.get(`${API}/member/:id/watchlist`, () =>
    HttpResponse.json({
      items: [makeWatchlistFilm()],
    }),
  ),

  // User lists
  http.get(`${API}/member/:id/lists`, () =>
    HttpResponse.json({
      items: [makeList()],
    }),
  ),

  // List entries
  http.get(`${API}/list/:id/entries`, () =>
    HttpResponse.json({
      items: [{ rank: 1, film: makeWatchlistFilm() }],
    }),
  ),

  // List detail
  http.get(`${API}/list/:id`, ({ params }) =>
    HttpResponse.json(makeList({ id: params['id'] })),
  ),

  // Log entries (diary)
  http.get(`${API}/log-entries`, () =>
    HttpResponse.json({
      items: [makeLogEntry()],
    }),
  ),

  // Activity (friends)
  http.get(`${API}/activity`, () =>
    HttpResponse.json({
      items: [{
        type: 'DiaryEntryActivity',
        member: makeMember(),
        whenCreated: '2024-01-15T10:00:00Z',
        diaryEntry: { film: makeWatchlistFilm(), rating: 4 },
      }],
    }),
  ),

  // Search members
  http.get(`${API}/search`, ({ request }) => {
    const url = new URL(request.url);
    const input = url.searchParams.get('input') ?? '';
    return HttpResponse.json({
      items: [{
        type: 'MemberSearchItem',
        score: 1,
        member: makeMember({ username: input }),
      }],
    });
  }),

  // Member by ID
  http.get(`${API}/member/:id`, ({ params }) =>
    HttpResponse.json(makeMember({ id: params['id'] })),
  ),

  // Lists search
  http.get(`${API}/lists`, () =>
    HttpResponse.json({ items: [makeList()] }),
  ),

  // Contributors search
  http.get(`${API}/contributors`, () =>
    HttpResponse.json({ items: [] }),
  ),

  // Contributor contributions
  http.get(`${API}/contributor/:id/contributions`, () =>
    HttpResponse.json({ items: [] }),
  ),

  // Film reviews
  http.get(`${API}/film/:id/reviews`, () =>
    HttpResponse.json({ items: [] }),
  ),

  // ── TMDB ──────────────────────────────────────────────────────────

  http.get(`${TMDB}/movie/:id/recommendations`, () =>
    HttpResponse.json({ results: [] }),
  ),

  http.get(`${TMDB}/movie/:id/external_ids`, () =>
    HttpResponse.json({ imdb_id: 'tt9999999' }),
  ),
];

// ── Server instance ─────────────────────────────────────────────────

export const mswServer = setupServer(...defaultHandlers);
