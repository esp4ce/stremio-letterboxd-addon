import { describe, it, expect } from 'vitest';
import { filterUnreleasedFilms, parseExtra, parseCombinedFilter } from '../../../../src/modules/stremio/catalog/catalog-filter.js';
import type { StremioMeta } from '../../../../src/modules/stremio/catalog.service.js';

function makeMeta(overrides: Partial<StremioMeta> = {}): StremioMeta {
  return {
    id: 'tt0000001',
    type: 'movie',
    name: 'Test Film',
    year: 2020,
    ...overrides,
  };
}

describe('filterUnreleasedFilms', () => {
  const currentYear = new Date().getFullYear();

  it('filters unreleased films when hideUnreleased is true', () => {
    const metas = [
      makeMeta({ id: 'tt1', year: 2020 }),
      makeMeta({ id: 'tt2', year: currentYear + 2 }),
      makeMeta({ id: 'tt3', year: currentYear }),
    ];

    const result = filterUnreleasedFilms(metas, true);

    expect(result).toHaveLength(2);
    expect(result.map((m) => m.id)).toEqual(['tt1', 'tt3']);
  });

  it('filters films without a year when hideUnreleased is true', () => {
    const metas = [
      makeMeta({ id: 'tt1', year: 2020 }),
      makeMeta({ id: 'tt2', year: undefined }),
    ];

    const result = filterUnreleasedFilms(metas, true);

    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('tt1');
  });

  it('returns all films when hideUnreleased is false', () => {
    const metas = [
      makeMeta({ id: 'tt1', year: currentYear + 5 }),
      makeMeta({ id: 'tt2', year: undefined }),
    ];

    const result = filterUnreleasedFilms(metas, false);

    expect(result).toHaveLength(2);
  });

  it('keeps current year films', () => {
    const metas = [makeMeta({ year: currentYear })];
    const result = filterUnreleasedFilms(metas, true);

    expect(result).toHaveLength(1);
  });
});

describe('parseExtra', () => {
  it('parses skip and genre params', () => {
    const result = parseExtra('skip=20&genre=Action');

    expect(result).toEqual({ skip: '20', genre: 'Action' });
  });

  it('handles URL-encoded values', () => {
    const result = parseExtra('genre=Release%20Date%20(Newest)');

    expect(result['genre']).toBe('Release Date (Newest)');
  });

  it('returns empty object for undefined input', () => {
    expect(parseExtra(undefined)).toEqual({});
  });

  it('returns empty object for empty string', () => {
    expect(parseExtra('')).toEqual({});
  });
});

describe('parseCombinedFilter', () => {
  it('returns defaults when no extra', () => {
    const result = parseCombinedFilter();

    expect(result.skip).toBe(0);
    expect(result.isShuffle).toBe(false);
    expect(result.isNotWatched).toBe(false);
    expect(result.isReleasedOnly).toBe(false);
  });

  it('parses skip value', () => {
    const result = parseCombinedFilter('skip=100');

    expect(result.skip).toBe(100);
  });

  it('detects Shuffle mode', () => {
    const result = parseCombinedFilter('genre=Shuffle');

    expect(result.isShuffle).toBe(true);
  });

  it('detects Not Watched mode', () => {
    const result = parseCombinedFilter('genre=Not%20Watched');

    expect(result.isNotWatched).toBe(true);
  });

  it('detects Released Only mode', () => {
    const result = parseCombinedFilter('genre=Released%20Only');

    expect(result.isReleasedOnly).toBe(true);
  });

  it('detects decade filter', () => {
    const result = parseCombinedFilter('genre=1990s');

    expect(result.decade).toBe(1990);
  });

  it('detects sort label', () => {
    const result = parseCombinedFilter('genre=Film%20Name');

    expect(result.sort).toBe('FilmName');
  });
});
