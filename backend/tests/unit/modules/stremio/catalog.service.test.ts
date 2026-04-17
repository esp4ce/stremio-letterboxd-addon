import { describe, it, expect } from 'vitest';
import type { WatchlistFilm, LogEntry, ActivityItem, LetterboxdFilm } from '../../../../src/modules/letterboxd/letterboxd.client.js';
import {
  getImdbId,
  getTmdbId,
  getPosterUrl,
  buildPosterUrl,
  transformToStremioMeta,
  transformWatchlistToMetas,
  transformLogEntryToMeta,
  transformLogEntriesToMetas,
  transformActivityToMetas,
  transformSearchResultsToMetas,
} from '../../../../src/modules/stremio/catalog.service.js';

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function makeFilm(overrides: Partial<WatchlistFilm> = {}): WatchlistFilm {
  return {
    type: 'film',
    id: 'abc123',
    name: 'Test Film',
    releaseYear: 2023,
    poster: {
      sizes: [
        { width: 150, height: 225, url: 'https://img.example.com/150.jpg' },
        { width: 300, height: 450, url: 'https://img.example.com/300.jpg' },
        { width: 600, height: 900, url: 'https://img.example.com/600.jpg' },
      ],
    },
    directors: [{ id: 'd1', name: 'Jane Director' }],
    genres: [{ id: 'g1', name: 'Drama' }],
    links: [
      { type: 'imdb', id: 'tt1234567', url: 'https://imdb.com/title/tt1234567' },
      { type: 'tmdb', id: '99999', url: 'https://tmdb.org/movie/99999' },
    ],
    rating: 4.0,
    runTime: 120,
    ...overrides,
  };
}

function makeLogEntry(overrides: Partial<LogEntry> = {}): LogEntry {
  const film = makeFilm();
  return {
    id: 'entry1',
    diaryDate: '2024-01-15',
    rating: 4.0,
    like: true,
    review: undefined,
    film: {
      type: film.type,
      id: film.id,
      name: film.name,
      releaseYear: film.releaseYear,
      poster: film.poster,
      directors: film.directors,
      genres: film.genres,
      links: film.links,
    },
    owner: { id: 'owner1', username: 'testuser', displayName: 'Test User' },
    ...overrides,
  };
}

function makeActivityItem(overrides: Partial<ActivityItem> = {}): ActivityItem {
  return {
    type: 'FilmRatingActivity',
    member: { id: 'member1', username: 'friend1', displayName: 'Friend One' },
    whenCreated: '2024-01-15T12:00:00Z',
    film: makeFilm(),
    rating: 3.5,
    ...overrides,
  };
}

function makeLetterboxdFilm(overrides: Partial<LetterboxdFilm> = {}): LetterboxdFilm {
  return {
    id: 'lbx1',
    name: 'Search Film',
    releaseYear: 2022,
    poster: {
      sizes: [
        { width: 300, height: 450, url: 'https://img.example.com/300.jpg' },
      ],
    },
    links: [{ type: 'imdb', id: 'tt9999999', url: 'https://imdb.com/title/tt9999999' }],
    genres: [{ id: 'g1', name: 'Thriller' }],
    contributions: [
      { type: 'Director', contributors: [{ id: 'd1', name: 'A Director' }] },
    ],
    runTime: 95,
    description: 'A thrilling film.',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('getImdbId', () => {
  it('returns IMDb ID when imdb link exists', () => {
    expect(getImdbId(makeFilm())).toBe('tt1234567');
  });

  it('returns null when no imdb link', () => {
    expect(getImdbId(makeFilm({ links: [{ type: 'tmdb', id: '123', url: '' }] }))).toBeNull();
  });

  it('returns null when links is undefined', () => {
    expect(getImdbId(makeFilm({ links: undefined }))).toBeNull();
  });
});

describe('getTmdbId', () => {
  it('returns number when tmdb link exists', () => {
    expect(getTmdbId(makeFilm())).toBe(99999);
  });

  it('returns null when no tmdb link', () => {
    expect(getTmdbId(makeFilm({ links: [{ type: 'imdb', id: 'tt1', url: '' }] }))).toBeNull();
  });

  it('returns null for non-numeric tmdb ID', () => {
    expect(getTmdbId(makeFilm({ links: [{ type: 'tmdb', id: 'abc', url: '' }] }))).toBeNull();
  });
});

describe('getPosterUrl', () => {
  it('prefers 300px width', () => {
    expect(getPosterUrl(makeFilm())).toBe('https://img.example.com/300.jpg');
  });

  it('falls back to last size when no 300px', () => {
    const film = makeFilm({
      poster: {
        sizes: [
          { width: 150, height: 225, url: 'https://img.example.com/150.jpg' },
          { width: 600, height: 900, url: 'https://img.example.com/600.jpg' },
        ],
      },
    });
    expect(getPosterUrl(film)).toBe('https://img.example.com/600.jpg');
  });

  it('returns undefined when no poster', () => {
    expect(getPosterUrl(makeFilm({ poster: undefined }))).toBeUndefined();
  });

  it('returns undefined when poster sizes is empty', () => {
    expect(getPosterUrl(makeFilm({ poster: { sizes: [] } }))).toBeUndefined();
  });
});

describe('buildPosterUrl', () => {
  it('returns proxy URL with encoded poster and rating', () => {
    const url = buildPosterUrl('https://img.example.com/300.jpg', 4.5);
    expect(url).toBe(
      'http://localhost:3001/poster?url=https%3A%2F%2Fimg.example.com%2F300.jpg&rating=4.5',
    );
  });

  it('returns original poster when no rating', () => {
    expect(buildPosterUrl('https://img.example.com/300.jpg')).toBe('https://img.example.com/300.jpg');
  });

  it('returns original poster when rating is 0', () => {
    expect(buildPosterUrl('https://img.example.com/300.jpg', 0)).toBe('https://img.example.com/300.jpg');
  });

  it('returns undefined when no poster', () => {
    expect(buildPosterUrl(undefined, 4.0)).toBeUndefined();
  });
});

describe('transformToStremioMeta', () => {
  it('returns correct StremioMeta with all fields', () => {
    const meta = transformToStremioMeta(makeFilm());
    expect(meta).toEqual({
      id: 'tt1234567',
      type: 'movie',
      name: 'Test Film',
      poster: 'http://localhost:3001/poster?url=https%3A%2F%2Fimg.example.com%2F300.jpg&rating=4.0',
      year: 2023,
      genres: ['Drama'],
      director: ['Jane Director'],
      runtime: '120 min',
    });
  });

  it('returns null when film has no IMDb ID', () => {
    expect(transformToStremioMeta(makeFilm({ links: [] }))).toBeNull();
  });

  it('uses plain poster when showRatings is false', () => {
    const meta = transformToStremioMeta(makeFilm(), false);
    expect(meta?.poster).toBe('https://img.example.com/300.jpg');
  });

  it('uses plain poster when film has no rating', () => {
    const meta = transformToStremioMeta(makeFilm({ rating: undefined }));
    expect(meta?.poster).toBe('https://img.example.com/300.jpg');
  });
});

describe('transformWatchlistToMetas', () => {
  it('transforms array and filters films without IMDb ID', () => {
    const films = [makeFilm(), makeFilm({ links: [], id: 'noImdb', name: 'No IMDB' })];
    const metas = transformWatchlistToMetas(films);
    expect(metas).toHaveLength(1);
    expect(metas[0]!.id).toBe('tt1234567');
  });

  it('returns empty array for empty input', () => {
    expect(transformWatchlistToMetas([])).toEqual([]);
  });
});

describe('transformLogEntryToMeta', () => {
  it('builds description with liked, rating and date', () => {
    const meta = transformLogEntryToMeta(makeLogEntry());
    expect(meta).not.toBeNull();
    expect(meta!.description).toContain('Liked');
    expect(meta!.description).toContain('★★★★');
    expect(meta!.description).toContain('15 Jan 2024');
  });

  it('returns null when film has no IMDb ID', () => {
    const entry = makeLogEntry({ film: { type: 'film', id: 'x', name: 'X', links: [] } });
    expect(transformLogEntryToMeta(entry)).toBeNull();
  });

  it('includes review excerpt truncated at 100 chars', () => {
    const longReview = 'A'.repeat(150);
    const entry = makeLogEntry({ review: { lbml: longReview } });
    const meta = transformLogEntryToMeta(entry);
    expect(meta!.description).toContain('…');
    // 100 chars + opening quote + ellipsis
    const reviewLine = meta!.description!.split('\n').pop()!;
    // The quoted excerpt should be 100 chars of content + quote marks + ellipsis
    expect(reviewLine.length).toBeLessThanOrEqual(104); // "  + 100 + … + "
  });

  it('includes short review without truncation', () => {
    const entry = makeLogEntry({ review: { lbml: 'Great film!' } });
    const meta = transformLogEntryToMeta(entry);
    expect(meta!.description).toContain('"Great film!"');
  });

  it('omits description parts when fields are missing', () => {
    const entry = makeLogEntry({ like: false, rating: undefined, diaryDate: undefined, review: undefined });
    const meta = transformLogEntryToMeta(entry);
    expect(meta!.description).toBeUndefined();
  });
});

describe('transformLogEntriesToMetas', () => {
  it('deduplicates by IMDb ID', () => {
    const entries = [makeLogEntry({ id: 'e1' }), makeLogEntry({ id: 'e2' })];
    const metas = transformLogEntriesToMetas(entries);
    expect(metas).toHaveLength(1);
  });

  it('keeps first occurrence on duplicate', () => {
    const entries = [
      makeLogEntry({ id: 'e1', rating: 5.0 }),
      makeLogEntry({ id: 'e2', rating: 1.0 }),
    ];
    const metas = transformLogEntriesToMetas(entries);
    expect(metas[0]!.description).toContain('★★★★★');
  });
});

describe('transformActivityToMetas', () => {
  it('excludes own activity', () => {
    const items = [makeActivityItem({ member: { id: 'me', username: 'me' } })];
    const metas = transformActivityToMetas(items, 'me');
    expect(metas).toHaveLength(0);
  });

  it('deduplicates by IMDb ID', () => {
    const items = [
      makeActivityItem({ member: { id: 'm1', username: 'a' } }),
      makeActivityItem({ member: { id: 'm2', username: 'b' } }),
    ];
    const metas = transformActivityToMetas(items, 'me');
    expect(metas).toHaveLength(1);
  });

  it('builds description for FilmRatingActivity', () => {
    const items = [makeActivityItem({ type: 'FilmRatingActivity', rating: 3.5 })];
    const metas = transformActivityToMetas(items, 'me');
    expect(metas[0]!.description).toBe('Rated ★★★½ by Friend One');
  });

  it('builds description for WatchlistActivity', () => {
    const items = [makeActivityItem({ type: 'WatchlistActivity' })];
    const metas = transformActivityToMetas(items, 'me');
    expect(metas[0]!.description).toBe('Added to watchlist by Friend One');
  });

  it('builds description for DiaryEntryActivity', () => {
    const items = [
      makeActivityItem({
        type: 'DiaryEntryActivity',
        film: undefined,
        diaryEntry: {
          like: true,
          rating: 4.0,
          diaryDetails: { diaryDate: '2024-03-10' },
          film: makeFilm(),
        },
      }),
    ];
    const metas = transformActivityToMetas(items, 'me');
    expect(metas[0]!.description).toContain('Liked');
    expect(metas[0]!.description).toContain('Rated ★★★★');
    expect(metas[0]!.description).toContain('by Friend One');
    expect(metas[0]!.description).toContain('on 2024-03-10');
  });

  it('builds fallback description for unknown activity type', () => {
    const items = [makeActivityItem({ type: 'UnknownActivity' })];
    const metas = transformActivityToMetas(items, 'me');
    expect(metas[0]!.description).toBe('Activity by Friend One');
  });

  it('skips items without a film', () => {
    const items = [makeActivityItem({ film: undefined, diaryEntry: undefined })];
    const metas = transformActivityToMetas(items, 'me');
    expect(metas).toHaveLength(0);
  });
});

describe('transformSearchResultsToMetas', () => {
  it('transforms films with contributions', () => {
    const metas = transformSearchResultsToMetas([makeLetterboxdFilm()]);
    expect(metas).toHaveLength(1);
    expect(metas[0]).toEqual({
      id: 'tt9999999',
      type: 'movie',
      name: 'Search Film',
      poster: 'https://img.example.com/300.jpg',
      year: 2022,
      genres: ['Thriller'],
      director: ['A Director'],
      runtime: '95 min',
      description: 'A thrilling film.',
    });
  });

  it('skips films without IMDb ID', () => {
    const metas = transformSearchResultsToMetas([makeLetterboxdFilm({ links: [] })]);
    expect(metas).toHaveLength(0);
  });

  it('handles films without contributions', () => {
    const metas = transformSearchResultsToMetas([makeLetterboxdFilm({ contributions: undefined })]);
    expect(metas[0]!.director).toBeUndefined();
  });
});
