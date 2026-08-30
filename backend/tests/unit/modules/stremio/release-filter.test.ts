import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the TMDB client and config before importing the module under test
vi.mock('../../../../src/lib/tmdb-client.js', () => ({
  findTmdbIdByImdbId: vi.fn(),
  getTmdbReleaseDates: vi.fn(),
}));

vi.mock('../../../../src/config/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/config/index.js')>();
  return { ...actual, tmdbConfig: { apiKey: 'test-api-key' as string | undefined } };
});

import { filterFilmsByReleaseData } from '../../../../src/modules/stremio/catalog/release-filter.js';
import { findTmdbIdByImdbId, getTmdbReleaseDates } from '../../../../src/lib/tmdb-client.js';
import { tmdbConfig } from '../../../../src/config/index.js';
import { imdbToTmdbCache, releaseDatesCache } from '../../../../src/lib/cache.js';
import type { StremioMeta } from '../../../../src/modules/stremio/catalog.service.js';

const mockFind = vi.mocked(findTmdbIdByImdbId);
const mockReleaseDates = vi.mocked(getTmdbReleaseDates);

const currentYear = new Date().getFullYear();

function makeMeta(overrides: Partial<StremioMeta> = {}): StremioMeta {
  return { id: 'tt1', type: 'movie', name: 'Film', year: 2020, ...overrides };
}

const future = new Date(Date.now() + 90 * 864e5).toISOString().slice(0, 10);
const past = '2020-01-01';
const recentPast = new Date(Date.now() - 180 * 864e5).toISOString().slice(0, 10);

beforeEach(() => {
  vi.clearAllMocks();
  imdbToTmdbCache.clear();
  releaseDatesCache.clear();
  (tmdbConfig as { apiKey?: string }).apiKey = 'test-api-key';
  mockFind.mockResolvedValue(100);
});

describe('filterFilmsByReleaseData — hideUnreleased (#77)', () => {
  it('hides a film released later in the current year', async () => {
    mockReleaseDates.mockResolvedValue([
      { iso_3166_1: 'US', release_dates: [{ type: 3, release_date: future }] },
    ]);
    const metas = [makeMeta({ id: 'tt1', year: currentYear })];

    const result = await filterFilmsByReleaseData(metas, {
      hideUnreleased: true,
      hideNoHomeRelease: false,
    });

    expect(result).toHaveLength(0);
  });

  it('keeps a film already released this year', async () => {
    mockReleaseDates.mockResolvedValue([
      { iso_3166_1: 'US', release_dates: [{ type: 3, release_date: past }] },
    ]);
    const result = await filterFilmsByReleaseData([makeMeta({ year: currentYear })], {
      hideUnreleased: true,
      hideNoHomeRelease: false,
    });
    expect(result).toHaveLength(1);
  });

  it('falls back to the year filter when TMDB has no date', async () => {
    mockFind.mockResolvedValue(null);
    const metas = [
      makeMeta({ id: 'a', year: 2020 }),
      makeMeta({ id: 'b', year: currentYear + 2 }),
      makeMeta({ id: 'c', year: undefined }),
    ];

    const result = await filterFilmsByReleaseData(metas, {
      hideUnreleased: true,
      hideNoHomeRelease: false,
    });

    expect(result.map((m) => m.id)).toEqual(['a']);
  });
});

describe('filterFilmsByReleaseData — hideNoHomeRelease (#90)', () => {
  it('hides a recent film with no digital/physical/TV release', async () => {
    mockReleaseDates.mockResolvedValue([
      { iso_3166_1: 'US', release_dates: [{ type: 3, release_date: recentPast }] },
    ]);
    const result = await filterFilmsByReleaseData([makeMeta()], {
      hideUnreleased: false,
      hideNoHomeRelease: true,
    });
    expect(result).toHaveLength(0);
  });

  it('keeps an old film even with no home-release entry in TMDB', async () => {
    mockReleaseDates.mockResolvedValue([
      { iso_3166_1: 'US', release_dates: [{ type: 3, release_date: '2005-01-01' }] },
    ]);
    const result = await filterFilmsByReleaseData([makeMeta()], {
      hideUnreleased: false,
      hideNoHomeRelease: true,
    });
    expect(result).toHaveLength(1);
  });

  it('keeps a film with a past digital release in any country', async () => {
    mockReleaseDates.mockResolvedValue([
      { iso_3166_1: 'FR', release_dates: [{ type: 4, release_date: past }] },
    ]);
    const result = await filterFilmsByReleaseData([makeMeta()], {
      hideUnreleased: false,
      hideNoHomeRelease: true,
    });
    expect(result).toHaveLength(1);
  });

  it('hides a film whose physical release is still upcoming', async () => {
    mockReleaseDates.mockResolvedValue([
      { iso_3166_1: 'US', release_dates: [{ type: 5, release_date: future }] },
    ]);
    const result = await filterFilmsByReleaseData([makeMeta()], {
      hideUnreleased: false,
      hideNoHomeRelease: true,
    });
    expect(result).toHaveLength(0);
  });

  it('does not filter when TMDB is unavailable for the film', async () => {
    mockFind.mockResolvedValue(null);
    const result = await filterFilmsByReleaseData([makeMeta()], {
      hideUnreleased: false,
      hideNoHomeRelease: true,
    });
    expect(result).toHaveLength(1);
  });
});

describe('filterFilmsByReleaseData — guards', () => {
  it('returns the list unchanged when no option is active', async () => {
    const metas = [makeMeta({ year: currentYear + 5 })];
    const result = await filterFilmsByReleaseData(metas, {
      hideUnreleased: false,
      hideNoHomeRelease: false,
    });
    expect(result).toEqual(metas);
    expect(mockFind).not.toHaveBeenCalled();
  });

  it('no API key: year fallback for hideUnreleased, no home filtering', async () => {
    (tmdbConfig as { apiKey?: string }).apiKey = undefined;
    const metas = [
      makeMeta({ id: 'a', year: 2020 }),
      makeMeta({ id: 'b', year: currentYear + 3 }),
    ];

    const unreleased = await filterFilmsByReleaseData(metas, {
      hideUnreleased: true,
      hideNoHomeRelease: true,
    });
    expect(unreleased.map((m) => m.id)).toEqual(['a']);
    expect(mockFind).not.toHaveBeenCalled();
  });

  it('caches the TMDB result between two calls', async () => {
    mockReleaseDates.mockResolvedValue([
      { iso_3166_1: 'US', release_dates: [{ type: 3, release_date: past }] },
    ]);
    const opts = { hideUnreleased: true, hideNoHomeRelease: false };
    await filterFilmsByReleaseData([makeMeta()], opts);
    await filterFilmsByReleaseData([makeMeta()], opts);
    expect(mockReleaseDates).toHaveBeenCalledTimes(1);
  });
});
