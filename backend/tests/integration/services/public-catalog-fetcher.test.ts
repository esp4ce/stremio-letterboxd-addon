import { describe, it, expect } from 'vitest';
import {
  transformToStremioMeta,
  transformWatchlistToMetas,
  getImdbId,
  getTmdbId,
  getPosterUrl,
  buildPosterUrl,
} from '../../../src/modules/stremio/catalog.service.js';

// Test the transformation functions used by public-catalog-fetcher

describe('catalog.service transformations (public catalogs)', () => {
  const makeFilm = (overrides = {}) => ({
    id: 'film-1',
    name: 'Test Film',
    releaseYear: 2024,
    rating: 4.5,
    genres: [{ name: 'Drama' }],
    directors: [{ name: 'Test Director' }],
    runTime: 120,
    poster: {
      sizes: [
        { width: 150, url: 'https://a.ltrbxd.com/150.jpg' },
        { width: 300, url: 'https://a.ltrbxd.com/300.jpg' },
        { width: 600, url: 'https://a.ltrbxd.com/600.jpg' },
      ],
    },
    links: [
      { type: 'imdb', id: 'tt1234567' },
      { type: 'tmdb', id: '99999' },
    ],
    ...overrides,
  });

  describe('getImdbId', () => {
    it('extracts IMDb ID from links', () => {
      const film = makeFilm();
      expect(getImdbId(film)).toBe('tt1234567');
    });

    it('returns null when no IMDb link', () => {
      const film = makeFilm({ links: [{ type: 'tmdb', id: '123' }] });
      expect(getImdbId(film)).toBeNull();
    });

    it('returns null when no links', () => {
      const film = makeFilm({ links: undefined });
      expect(getImdbId(film)).toBeNull();
    });
  });

  describe('getTmdbId', () => {
    it('extracts TMDB ID from links', () => {
      const film = makeFilm();
      expect(getTmdbId(film as never)).toBe(99999);
    });

    it('returns null for non-numeric TMDB ID', () => {
      const film = makeFilm({ links: [{ type: 'tmdb', id: 'abc' }] });
      expect(getTmdbId(film as never)).toBeNull();
    });
  });

  describe('getPosterUrl', () => {
    it('prefers 300px width poster', () => {
      const film = makeFilm();
      expect(getPosterUrl(film)).toBe('https://a.ltrbxd.com/300.jpg');
    });

    it('falls back to largest available', () => {
      const film = makeFilm({
        poster: {
          sizes: [{ width: 600, url: 'https://a.ltrbxd.com/600.jpg' }],
        },
      });
      expect(getPosterUrl(film)).toBe('https://a.ltrbxd.com/600.jpg');
    });

    it('returns undefined when no poster', () => {
      const film = makeFilm({ poster: undefined });
      expect(getPosterUrl(film)).toBeUndefined();
    });

    it('returns undefined for empty sizes array', () => {
      const film = makeFilm({ poster: { sizes: [] } });
      expect(getPosterUrl(film)).toBeUndefined();
    });
  });

  describe('buildPosterUrl', () => {
    it('adds rating badge URL when both poster and rating provided', () => {
      const url = buildPosterUrl('https://a.ltrbxd.com/300.jpg', 4.5);
      expect(url).toContain('/poster?url=');
      expect(url).toContain('rating=4.5');
    });

    it('returns original poster when no rating', () => {
      const url = buildPosterUrl('https://a.ltrbxd.com/300.jpg');
      expect(url).toBe('https://a.ltrbxd.com/300.jpg');
    });

    it('returns undefined when no poster', () => {
      expect(buildPosterUrl(undefined, 4.0)).toBeUndefined();
    });
  });

  describe('transformToStremioMeta', () => {
    it('transforms film to Stremio meta', () => {
      const film = makeFilm();
      const meta = transformToStremioMeta(film as never);

      expect(meta).not.toBeNull();
      expect(meta!.id).toBe('tt1234567');
      expect(meta!.type).toBe('movie');
      expect(meta!.name).toBe('Test Film');
      expect(meta!.year).toBe(2024);
      expect(meta!.genres).toEqual(['Drama']);
      expect(meta!.director).toEqual(['Test Director']);
      expect(meta!.runtime).toBe('120 min');
    });

    it('returns null for film without IMDb ID', () => {
      const film = makeFilm({ links: [] });
      const meta = transformToStremioMeta(film as never);

      expect(meta).toBeNull();
    });

    it('includes rating badge in poster when showRatings is true', () => {
      const film = makeFilm();
      const meta = transformToStremioMeta(film as never, true);

      expect(meta!.poster).toContain('/poster?url=');
      expect(meta!.poster).toContain('rating=');
    });

    it('uses raw poster when showRatings is false', () => {
      const film = makeFilm();
      const meta = transformToStremioMeta(film as never, false);

      expect(meta!.poster).toBe('https://a.ltrbxd.com/300.jpg');
    });
  });

  describe('transformWatchlistToMetas', () => {
    it('transforms array and skips films without IMDb', () => {
      const films = [
        makeFilm({ id: 'f1' }),
        makeFilm({ id: 'f2', links: [] }),
        makeFilm({ id: 'f3' }),
      ];

      const metas = transformWatchlistToMetas(films as never[]);

      expect(metas).toHaveLength(2);
    });

    it('returns empty array for empty input', () => {
      expect(transformWatchlistToMetas([])).toEqual([]);
    });
  });
});
