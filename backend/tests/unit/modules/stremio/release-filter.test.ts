import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock du client TMDB et de la config avant import du module testé
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
  it('masque un film qui sort plus tard dans l’année courante', async () => {
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

  it('garde un film déjà sorti cette année', async () => {
    mockReleaseDates.mockResolvedValue([
      { iso_3166_1: 'US', release_dates: [{ type: 3, release_date: past }] },
    ]);
    const result = await filterFilmsByReleaseData([makeMeta({ year: currentYear })], {
      hideUnreleased: true,
      hideNoHomeRelease: false,
    });
    expect(result).toHaveLength(1);
  });

  it('retombe sur le filtre annuel quand TMDB n’a aucune date', async () => {
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
  it('masque un film récent sans sortie numérique/physique/TV', async () => {
    mockReleaseDates.mockResolvedValue([
      { iso_3166_1: 'US', release_dates: [{ type: 3, release_date: recentPast }] },
    ]);
    const result = await filterFilmsByReleaseData([makeMeta()], {
      hideUnreleased: false,
      hideNoHomeRelease: true,
    });
    expect(result).toHaveLength(0);
  });

  it('garde un vieux film même sans entrée de sortie home dans TMDB', async () => {
    mockReleaseDates.mockResolvedValue([
      { iso_3166_1: 'US', release_dates: [{ type: 3, release_date: '2005-01-01' }] },
    ]);
    const result = await filterFilmsByReleaseData([makeMeta()], {
      hideUnreleased: false,
      hideNoHomeRelease: true,
    });
    expect(result).toHaveLength(1);
  });

  it('garde un film avec une sortie numérique passée dans n’importe quel pays', async () => {
    mockReleaseDates.mockResolvedValue([
      { iso_3166_1: 'FR', release_dates: [{ type: 4, release_date: past }] },
    ]);
    const result = await filterFilmsByReleaseData([makeMeta()], {
      hideUnreleased: false,
      hideNoHomeRelease: true,
    });
    expect(result).toHaveLength(1);
  });

  it('masque un film dont la sortie physique est encore à venir', async () => {
    mockReleaseDates.mockResolvedValue([
      { iso_3166_1: 'US', release_dates: [{ type: 5, release_date: future }] },
    ]);
    const result = await filterFilmsByReleaseData([makeMeta()], {
      hideUnreleased: false,
      hideNoHomeRelease: true,
    });
    expect(result).toHaveLength(0);
  });

  it('ne filtre pas quand TMDB est indisponible pour ce film', async () => {
    mockFind.mockResolvedValue(null);
    const result = await filterFilmsByReleaseData([makeMeta()], {
      hideUnreleased: false,
      hideNoHomeRelease: true,
    });
    expect(result).toHaveLength(1);
  });
});

describe('filterFilmsByReleaseData — garde-fous', () => {
  it('renvoie la liste inchangée si aucune option active', async () => {
    const metas = [makeMeta({ year: currentYear + 5 })];
    const result = await filterFilmsByReleaseData(metas, {
      hideUnreleased: false,
      hideNoHomeRelease: false,
    });
    expect(result).toEqual(metas);
    expect(mockFind).not.toHaveBeenCalled();
  });

  it('sans clé API : fallback annuel pour hideUnreleased, aucun filtrage home', async () => {
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

  it('met en cache le résultat TMDB entre deux appels', async () => {
    mockReleaseDates.mockResolvedValue([
      { iso_3166_1: 'US', release_dates: [{ type: 3, release_date: past }] },
    ]);
    const opts = { hideUnreleased: true, hideNoHomeRelease: false };
    await filterFilmsByReleaseData([makeMeta()], opts);
    await filterFilmsByReleaseData([makeMeta()], opts);
    expect(mockReleaseDates).toHaveBeenCalledTimes(1);
  });
});
