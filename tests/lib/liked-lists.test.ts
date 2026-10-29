import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchLikedLists,
  filterLikedLists,
  likedListsBlockedMessage,
  LikedListsError,
  withLikedList,
  type LikedList,
} from '../../src/lib/liked-lists';
import { setInMemorySessionToken } from '../../src/lib/session-token';
import type { UserPreferences } from '../../src/types/preferences';

const prefs: UserPreferences = {
  catalogs: { watchlist: true, diary: false, friends: false, popular: false, top250: false, likedFilms: false, recommended: false },
  ownLists: [],
  externalLists: [],
};

const heists: LikedList = { id: 'L1', name: 'Best Heists', owner: 'Alice', filmCount: 42 };
const slow: LikedList = { id: 'L2', name: 'Slow Burns', owner: 'Bob', filmCount: 7 };

describe('filterLikedLists', () => {
  it('returns everything for an empty or blank query', () => {
    expect(filterLikedLists([heists, slow], '')).toEqual([heists, slow]);
    expect(filterLikedLists([heists, slow], '   ')).toEqual([heists, slow]);
  });

  it('matches the list name or its owner, ignoring case', () => {
    expect(filterLikedLists([heists, slow], 'heist')).toEqual([heists]);
    expect(filterLikedLists([heists, slow], 'BOB')).toEqual([slow]);
  });

  it('returns nothing when nothing matches', () => {
    expect(filterLikedLists([heists, slow], 'zzz')).toEqual([]);
  });
});

describe('withLikedList', () => {
  it('adds the list to the external lists', () => {
    expect(withLikedList(prefs, heists).externalLists).toEqual([heists]);
  });

  it('keeps existing lists and does not mutate the input', () => {
    const before = { ...prefs, externalLists: [slow] };
    const after = withLikedList(before, heists);
    expect(after.externalLists).toEqual([slow, heists]);
    expect(before.externalLists).toEqual([slow]);
  });

  it('is idempotent for a list already added', () => {
    const once = withLikedList(prefs, heists);
    expect(withLikedList(once, heists)).toBe(once);
  });

  it('leaves the preferences alone when the member already owns that list', () => {
    const owned = { ...prefs, ownLists: ['L1'] };
    expect(withLikedList(owned, heists)).toBe(owned);
  });
});

describe('likedListsBlockedMessage', () => {
  it('points non-supporters at the subscription', () => {
    expect(likedListsBlockedMessage()).toMatch(/supporter/i);
  });
});

describe('fetchLikedLists', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setInMemorySessionToken(null);
  });

  function stubFetch(status: number, body: unknown) {
    const fn = vi.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => body });
    vi.stubGlobal('fetch', fn);
    return fn;
  }

  it('calls the backend with the session and returns the page', async () => {
    setInMemorySessionToken('tok');
    const fn = stubFetch(200, { items: [heists], cursor: 'start=50' });

    await expect(fetchLikedLists('https://api.test')).resolves.toEqual({ items: [heists], cursor: 'start=50' });

    const [url, init] = fn.mock.calls[0]!;
    expect(url).toBe('https://api.test/auth/liked-lists');
    expect(init.credentials).toBe('include');
    expect(init.headers.Authorization).toBe('Bearer tok');
  });

  it('forwards the cursor, encoded', async () => {
    const fn = stubFetch(200, { items: [] });
    await fetchLikedLists('https://api.test', 'start=50');
    expect(fn.mock.calls[0]![0]).toBe('https://api.test/auth/liked-lists?cursor=start%3D50');
  });

  it('turns NOT_ENTITLED into a typed error', async () => {
    stubFetch(403, { error: 'Supporter feature', code: 'NOT_ENTITLED' });
    await expect(fetchLikedLists('https://api.test')).rejects.toMatchObject({ code: 'not_entitled' });
  });

  it('turns an expired session into a typed error', async () => {
    stubFetch(401, { error: 'No active session', code: 'NO_SESSION' });
    await expect(fetchLikedLists('https://api.test')).rejects.toMatchObject({ code: 'session' });
  });

  it('turns any other failure into a failed error', async () => {
    stubFetch(500, { error: 'Internal server error' });
    const err = await fetchLikedLists('https://api.test').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LikedListsError);
    expect(err).toMatchObject({ code: 'failed' });
  });
});
