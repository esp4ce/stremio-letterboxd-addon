import { describe, it, expect } from 'vitest';
import {
  transformLogEntriesToMetas,
  transformListEntriesToMetas,
  transformActivityToMetas,
  transformSearchResultsToMetas,
} from '../../../src/modules/stremio/catalog.service.js';

describe('catalog-fetcher service transforms', () => {
  const makeLogEntry = (overrides = {}) => ({
    film: {
      id: 'film-1',
      name: 'Test Film',
      releaseYear: 2022,
      poster: { sizes: [{ width: 300, url: 'https://a.ltrbxd.com/300.jpg' }] },
      links: [{ type: 'imdb', id: 'tt0001111' }],
      genres: [{ name: 'Comedy' }],
      directors: [{ name: 'Dir A' }],
    },
    diaryDate: '2024-03-15',
    rating: 4.0,
    like: true,
    ...overrides,
  });

  describe('transformLogEntriesToMetas', () => {
    it('transforms log entries with diary info', () => {
      const entries = [makeLogEntry()];
      const metas = transformLogEntriesToMetas(entries as never[]);

      expect(metas).toHaveLength(1);
      expect(metas[0]!.id).toBe('tt0001111');
      expect(metas[0]!.description).toContain('Liked');
      expect(metas[0]!.description).toContain('15 Mar 2024');
    });

    it('deduplicates by IMDb ID', () => {
      const entries = [makeLogEntry(), makeLogEntry()];
      const metas = transformLogEntriesToMetas(entries as never[]);

      expect(metas).toHaveLength(1);
    });

    it('skips entries without IMDb ID', () => {
      const entry = makeLogEntry({
        film: { id: 'f', name: 'X', links: [], poster: undefined },
      });
      const metas = transformLogEntriesToMetas([entry] as never[]);

      expect(metas).toHaveLength(0);
    });

    it('includes review excerpt in description', () => {
      const entry = makeLogEntry({
        review: { lbml: 'A really great film that everyone should watch' },
      });
      const metas = transformLogEntriesToMetas([entry] as never[]);

      expect(metas[0]!.description).toContain('great film');
    });
  });

  describe('transformListEntriesToMetas', () => {
    const makeListEntry = (overrides = {}) => ({
      film: {
        id: 'list-film-1',
        name: 'List Film',
        releaseYear: 2023,
        rating: 3.5,
        poster: { sizes: [{ width: 300, url: 'https://a.ltrbxd.com/300.jpg' }] },
        links: [{ type: 'imdb', id: 'tt0002222' }],
        genres: [{ name: 'Action' }],
        directors: [{ name: 'Dir B' }],
        runTime: 95,
      },
      rank: 1,
      ...overrides,
    });

    it('transforms list entries with rank suffix', () => {
      const entries = [makeListEntry()];
      const metas = transformListEntriesToMetas(entries as never[]);

      expect(metas).toHaveLength(1);
      expect(metas[0]!.id).toBe('tt0002222');
      expect(metas[0]!._rankSuffix).toBe('#1');
    });

    it('handles entries without rank', () => {
      const entries = [makeListEntry({ rank: undefined })];
      const metas = transformListEntriesToMetas(entries as never[]);

      expect(metas[0]!._rankSuffix).toBeUndefined();
    });
  });

  describe('transformActivityToMetas', () => {
    const makeActivity = (overrides = {}) => ({
      type: 'DiaryEntryActivity',
      member: { id: 'friend-1', username: 'friend', displayName: 'Friend' },
      film: {
        id: 'act-film',
        name: 'Activity Film',
        releaseYear: 2024,
        poster: { sizes: [{ width: 300, url: 'https://a.ltrbxd.com/300.jpg' }] },
        links: [{ type: 'imdb', id: 'tt0003333' }],
        genres: [],
        directors: [],
      },
      diaryEntry: {
        film: {
          id: 'act-film',
          name: 'Activity Film',
          releaseYear: 2024,
          poster: { sizes: [{ width: 300, url: 'https://a.ltrbxd.com/300.jpg' }] },
          links: [{ type: 'imdb', id: 'tt0003333' }],
          genres: [],
          directors: [],
        },
        like: true,
        rating: 3.5,
        diaryDetails: { diaryDate: '2024-05-01' },
      },
      ...overrides,
    });

    it('transforms friend activity and excludes own', () => {
      const items = [
        makeActivity(),
        makeActivity({
          member: { id: 'self', username: 'me', displayName: 'Me' },
          film: {
            id: 'f2', name: 'F2', releaseYear: 2024,
            links: [{ type: 'imdb', id: 'tt9999999' }],
            poster: { sizes: [] }, genres: [], directors: [],
          },
        }),
      ];

      const metas = transformActivityToMetas(items as never[], 'self');

      expect(metas).toHaveLength(1);
      expect(metas[0]!.id).toBe('tt0003333');
    });

    it('deduplicates activity by IMDb ID', () => {
      const items = [makeActivity(), makeActivity()];
      const metas = transformActivityToMetas(items as never[], 'other');

      expect(metas).toHaveLength(1);
    });
  });

  describe('transformSearchResultsToMetas', () => {
    it('transforms search results with contributions', () => {
      const films = [
        {
          id: 'search-1',
          name: 'Search Film',
          releaseYear: 2023,
          poster: { sizes: [{ width: 300, url: 'https://a.ltrbxd.com/300.jpg' }] },
          links: [{ type: 'imdb', id: 'tt5555555' }],
          genres: [{ name: 'Thriller' }],
          contributions: [
            { type: 'Director', contributors: [{ name: 'Dir Search' }] },
          ],
          runTime: 110,
          description: 'A thrilling search result',
        },
      ];

      const metas = transformSearchResultsToMetas(films as never[]);

      expect(metas).toHaveLength(1);
      expect(metas[0]!.name).toBe('Search Film');
      expect(metas[0]!.director).toEqual(['Dir Search']);
      expect(metas[0]!.description).toBe('A thrilling search result');
    });

    it('skips films without IMDb ID', () => {
      const films = [
        {
          id: 's1', name: 'No IMDB',
          links: [], poster: { sizes: [] },
        },
      ];

      const metas = transformSearchResultsToMetas(films as never[]);
      expect(metas).toHaveLength(0);
    });
  });
});
