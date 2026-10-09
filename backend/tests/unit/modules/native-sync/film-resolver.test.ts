import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LetterboxdApiError } from '../../../../src/modules/letterboxd/letterboxd.client.js';
import { filmLookupCache, imdbToLetterboxdCache } from '../../../../src/lib/cache.js';
import { externalIdLookupBreaker, EXTERNAL_ID_FAILURE_THRESHOLD } from '../../../../src/modules/stremio/meta.service.js';

const getFullFilmInfoFromCinemeta = vi.fn();
vi.mock('../../../../src/modules/stremio/meta.service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/modules/stremio/meta.service.js')>();
  return { ...actual, getFullFilmInfoFromCinemeta: (...a: unknown[]) => getFullFilmInfoFromCinemeta(...a) };
});

const { resolveFilmForWrite, ResolverUnavailableError } = await import(
  '../../../../src/modules/native-sync/film-resolver.js'
);

const IMDB = 'tt0816692';
const withLink = (id: string, imdb: string, name = 'Interstellar', releaseYear = 2014) => ({
  id,
  name,
  releaseYear,
  links: [{ type: 'imdb', id: imdb }],
});
const noLinks = (id: string, name = 'Interstellar', releaseYear = 2014) => ({ id, name, releaseYear });

const client = {
  getFilmByExternalId: vi.fn(),
  getFilmByLid: vi.fn(),
  searchFilms: vi.fn(),
};

describe('resolveFilmForWrite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    externalIdLookupBreaker.reset();
    filmLookupCache.clear();
    imdbToLetterboxdCache.clear();
    client.getFilmByExternalId.mockResolvedValue(null);
    getFullFilmInfoFromCinemeta.mockResolvedValue({ name: 'Interstellar', year: 2014 });
    client.searchFilms.mockResolvedValue({ items: [] });
  });

  const run = () => resolveFilmForWrite(client as never, IMDB);

  it('accepts a cached mapping after one verifying read', async () => {
    imdbToLetterboxdCache.set(IMDB, 'lbCached');
    client.getFilmByLid.mockResolvedValue(withLink('lbCached', IMDB));
    expect(await run()).toEqual({ letterboxdFilmId: 'lbCached' });
    expect(client.getFilmByLid).toHaveBeenCalledTimes(1);
    expect(client.getFilmByExternalId).not.toHaveBeenCalled();
  });

  it('never trusts a wrong film seeded in both caches', async () => {
    imdbToLetterboxdCache.set(IMDB, 'lbWrong');
    filmLookupCache.set(IMDB, { letterboxdFilmId: 'lbWrong', film: noLinks('lbWrong') });
    client.getFilmByLid.mockResolvedValue(withLink('lbWrong', 'tt999'));
    client.getFilmByExternalId.mockResolvedValue(withLink('lbRight', IMDB));
    expect(await run()).toEqual({ letterboxdFilmId: 'lbRight' });
  });

  it('falls through when the mapped id is gone (404)', async () => {
    imdbToLetterboxdCache.set(IMDB, 'lbGone');
    client.getFilmByLid.mockRejectedValue(new LetterboxdApiError(404, 'Not Found'));
    client.getFilmByExternalId.mockResolvedValue(withLink('lbRight', IMDB));
    expect(await run()).toEqual({ letterboxdFilmId: 'lbRight' });
  });

  it('rethrows other errors from the verifying read', async () => {
    imdbToLetterboxdCache.set(IMDB, 'lbCached');
    client.getFilmByLid.mockRejectedValue(new LetterboxdApiError(503, 'Unavailable'));
    await expect(run()).rejects.toBeInstanceOf(LetterboxdApiError);
  });

  it('skips the external id lookup while its breaker is open', async () => {
    for (let i = 0; i < EXTERNAL_ID_FAILURE_THRESHOLD; i++) externalIdLookupBreaker.recordFailure();
    client.searchFilms.mockResolvedValue({ items: [withLink('lbS', IMDB)] });
    expect(await run()).toEqual({ letterboxdFilmId: 'lbS' });
    expect(client.getFilmByExternalId).not.toHaveBeenCalled();
  });

  it('records external id failures and successes on the breaker', async () => {
    client.getFilmByExternalId.mockRejectedValue(new LetterboxdApiError(500, 'x'));
    await expect(run()).rejects.toBeInstanceOf(LetterboxdApiError);
    client.getFilmByExternalId.mockResolvedValue(withLink('lbExt', IMDB));
    expect(await run()).toEqual({ letterboxdFilmId: 'lbExt' });
    expect(externalIdLookupBreaker.isOpen()).toBe(false);
  });

  it('ignores an unverified filmLookupCache entry', async () => {
    filmLookupCache.set(IMDB, { letterboxdFilmId: 'lbWrong', film: noLinks('lbWrong') });
    client.getFilmByLid.mockResolvedValue(withLink('lbWrong', 'tt999'));
    client.getFilmByExternalId.mockResolvedValue(withLink('lbRight', IMDB));
    expect(await run()).toEqual({ letterboxdFilmId: 'lbRight' });
  });

  it('accepts a filmLookupCache entry verified by its links, with no call', async () => {
    filmLookupCache.set(IMDB, { letterboxdFilmId: 'lbV', film: withLink('lbV', IMDB) });
    expect(await run()).toEqual({ letterboxdFilmId: 'lbV' });
    expect(client.getFilmByLid).not.toHaveBeenCalled();
    expect(client.getFilmByExternalId).not.toHaveBeenCalled();
  });

  it('accepts an external id hit', async () => {
    client.getFilmByExternalId.mockResolvedValue(withLink('lbExt', IMDB));
    expect(await run()).toEqual({ letterboxdFilmId: 'lbExt' });
    expect(client.searchFilms).not.toHaveBeenCalled();
  });

  it('falls through to search on an external id 404', async () => {
    client.getFilmByExternalId.mockRejectedValue(new LetterboxdApiError(404, 'Not Found'));
    client.searchFilms.mockResolvedValue({ items: [withLink('lbS', IMDB)] });
    expect(await run()).toEqual({ letterboxdFilmId: 'lbS' });
  });

  it('rethrows other external id errors', async () => {
    client.getFilmByExternalId.mockRejectedValue(new LetterboxdApiError(429, 'Too Many'));
    await expect(run()).rejects.toBeInstanceOf(LetterboxdApiError);
  });

  it('picks the search candidate whose links match, not the first one', async () => {
    client.searchFilms.mockResolvedValue({ items: [withLink('lbOther', 'tt999'), withLink('lbS', IMDB)] });
    expect(await run()).toEqual({ letterboxdFilmId: 'lbS' });
    expect(client.searchFilms).toHaveBeenCalledWith('Interstellar', { year: 2014, perPage: 10 });
  });

  it('verifies link-less exact candidates through getFilmByLid, at most 3', async () => {
    client.searchFilms.mockResolvedValue({
      items: [noLinks('a'), noLinks('b'), noLinks('c'), noLinks('d'), noLinks('x', 'Other')],
    });
    client.getFilmByLid.mockImplementation(async (id: string) => withLink(id, id === 'b' ? IMDB : 'tt1'));
    expect(await run()).toEqual({ letterboxdFilmId: 'b' });

    client.getFilmByLid.mockReset();
    client.getFilmByLid.mockImplementation(async (id: string) => withLink(id, 'tt1'));
    imdbToLetterboxdCache.clear();
    expect(await run()).toBeNull();
    expect(client.getFilmByLid).toHaveBeenCalledTimes(3);
  });

  it('returns null when no candidate carries the right imdb id', async () => {
    client.searchFilms.mockResolvedValue({ items: [withLink('lbOther', 'tt999')] });
    expect(await run()).toBeNull();
  });

  it('throws when search fails upstream', async () => {
    client.searchFilms.mockRejectedValue(new LetterboxdApiError(503, 'Unavailable'));
    await expect(run()).rejects.toBeInstanceOf(LetterboxdApiError);
  });

  it('throws a retryable error when Cinemeta has nothing', async () => {
    getFullFilmInfoFromCinemeta.mockResolvedValue(null);
    await expect(run()).rejects.toBeInstanceOf(ResolverUnavailableError);
  });
});
