import { describe, it, expect } from 'vitest';
import {
  generateBaseManifest,
  generatePublicManifest,
  generateDynamicManifest,
  PUBLIC_MANIFEST_DESCRIPTION,
} from '../../../../src/modules/stremio/stremio.service.js';
import type { PublicConfig } from '../../../../src/lib/config-encoding.js';
import type { UserPreferences } from '../../../../src/db/repositories/user.repository.js';
import type { UserList } from '../../../../src/modules/letterboxd/letterboxd.client.js';

function basePublicCfg(overrides: Partial<PublicConfig> = {}): PublicConfig {
  return {
    c: { popular: true, top250: true },
    l: [],
    r: true,
    ...overrides,
  };
}

function basePreferences(overrides: Partial<UserPreferences> = {}): UserPreferences {
  return {
    catalogs: {
      watchlist: true,
      diary: true,
      friends: true,
      popular: true,
      top250: true,
      likedFilms: true,
      recommended: true,
    },
    ownLists: [],
    externalLists: [],
    ...overrides,
  };
}

describe('generatePublicManifest — custom names with sort variants', () => {
  const listId = 'abc123';

  it('applies a custom name to a variant catalog when overridden by its variant ID key', () => {
    const cfg = basePublicCfg({
      l: [listId],
      s: { [`letterboxd-list-${listId}`]: ['shuffle'] },
      n: { [`letterboxd-list-${listId}--shuffle`]: 'My Shuffled List' },
    });
    const listNames = new Map([[listId, 'Original List']]);

    const manifest = generatePublicManifest(cfg, undefined, listNames);

    const variant = manifest.catalogs.find(
      (c) => c.id === `letterboxd-list-${listId}--shuffle`,
    );
    expect(variant).toBeDefined();
    expect(variant?.name).toBe('My Shuffled List');
  });

  it('propagates a parent rename into the default variant label when no variant override is set', () => {
    const cfg = basePublicCfg({
      l: [listId],
      s: { [`letterboxd-list-${listId}`]: ['shuffle'] },
      n: { [`letterboxd-list-${listId}`]: 'Renamed Parent' },
    });
    const listNames = new Map([[listId, 'Original List']]);

    const manifest = generatePublicManifest(cfg, undefined, listNames);

    const parent = manifest.catalogs.find((c) => c.id === `letterboxd-list-${listId}`);
    const variant = manifest.catalogs.find(
      (c) => c.id === `letterboxd-list-${listId}--shuffle`,
    );
    expect(parent?.name).toBe('Renamed Parent');
    expect(variant?.name).toBe('Renamed Parent (Shuffle)');
  });

  it('uses the default template label when no custom name is set', () => {
    const cfg = basePublicCfg({
      l: [listId],
      s: { [`letterboxd-list-${listId}`]: ['popular'] },
    });
    const listNames = new Map([[listId, 'Original List']]);

    const manifest = generatePublicManifest(cfg, undefined, listNames);

    const variant = manifest.catalogs.find(
      (c) => c.id === `letterboxd-list-${listId}--popular`,
    );
    expect(variant?.name).toBe('Original List (Popular)');
  });

  it('still renames the parent catalog when no variant exists', () => {
    const cfg = basePublicCfg({
      l: [listId],
      n: { [`letterboxd-list-${listId}`]: 'Renamed Parent' },
    });
    const listNames = new Map([[listId, 'Original List']]);

    const manifest = generatePublicManifest(cfg, undefined, listNames);

    const parent = manifest.catalogs.find((c) => c.id === `letterboxd-list-${listId}`);
    expect(parent?.name).toBe('Renamed Parent');
  });

  it('keeps orphan variants of a removed external list (regression #61)', () => {
    const cfg = basePublicCfg({
      l: [],
      s: { [`letterboxd-list-${listId}`]: ['shuffle'] },
    });
    const listNames = new Map([[listId, 'Original List']]);

    const manifest = generatePublicManifest(cfg, undefined, listNames);

    const parent = manifest.catalogs.find((c) => c.id === `letterboxd-list-${listId}`);
    const variant = manifest.catalogs.find(
      (c) => c.id === `letterboxd-list-${listId}--shuffle`,
    );
    expect(parent).toBeUndefined();
    expect(variant).toBeDefined();
    expect(variant?.name).toBe('Original List (Shuffle)');
  });

  it('keeps orphan variants of a disabled base catalog (regression #61)', () => {
    const cfg = basePublicCfg({
      u: 'alice',
      c: { popular: false, top250: false, watchlist: false },
      s: { 'letterboxd-watchlist': ['shuffle'], 'letterboxd-popular': ['shuffle'] },
    });

    const manifest = generatePublicManifest(cfg, 'Alice');

    expect(manifest.catalogs.find((c) => c.id === 'letterboxd-watchlist')).toBeUndefined();
    expect(manifest.catalogs.find((c) => c.id === 'letterboxd-popular')).toBeUndefined();
    const watchlistVariant = manifest.catalogs.find(
      (c) => c.id === 'letterboxd-watchlist--shuffle',
    );
    const popularVariant = manifest.catalogs.find(
      (c) => c.id === 'letterboxd-popular--shuffle',
    );
    expect(watchlistVariant?.name).toBe("Alice's Watchlist (Shuffle)");
    expect(popularVariant?.name).toBe('Popular This Week (Shuffle)');
  });
});

describe('generateDynamicManifest — custom names with sort variants', () => {
  const user = { username: 'alice', displayName: 'Alice' };
  const lists: UserList[] = [
    { id: 'abc123', name: 'Original List', filmCount: 42 } as UserList,
  ];

  it('applies a custom name to a variant catalog when overridden by its variant ID key', () => {
    const prefs = basePreferences({
      ownLists: ['abc123'],
      sortVariants: { 'letterboxd-list-abc123': ['shuffle'] },
      catalogNames: { 'letterboxd-list-abc123--shuffle': 'My Shuffled List' },
    });

    const manifest = generateDynamicManifest(user, lists, prefs);

    const variant = manifest.catalogs.find(
      (c) => c.id === 'letterboxd-list-abc123--shuffle',
    );
    expect(variant?.name).toBe('My Shuffled List');
  });

  it('propagates a parent rename into the default variant label when no variant override is set', () => {
    const prefs = basePreferences({
      ownLists: ['abc123'],
      sortVariants: { 'letterboxd-list-abc123': ['shuffle'] },
      catalogNames: { 'letterboxd-list-abc123': 'Renamed Parent' },
    });

    const manifest = generateDynamicManifest(user, lists, prefs);

    const parent = manifest.catalogs.find((c) => c.id === 'letterboxd-list-abc123');
    const variant = manifest.catalogs.find(
      (c) => c.id === 'letterboxd-list-abc123--shuffle',
    );
    expect(parent?.name).toBe('Renamed Parent');
    expect(variant?.name).toBe('Renamed Parent (Shuffle)');
  });

  it('uses the default template label when no custom name is set', () => {
    const prefs = basePreferences({
      ownLists: ['abc123'],
      sortVariants: { 'letterboxd-list-abc123': ['popular'] },
    });

    const manifest = generateDynamicManifest(user, lists, prefs);

    const variant = manifest.catalogs.find(
      (c) => c.id === 'letterboxd-list-abc123--popular',
    );
    expect(variant?.name).toBe('Original List (Popular)');
  });

  it('keeps orphan variants of a deleted external list (regression #61)', () => {
    const prefs = basePreferences({
      externalLists: [],
      sortVariants: { 'letterboxd-list-ext42': ['shuffle'] },
    });
    const orphanListNames = new Map([['ext42', 'Horror Classics']]);

    const manifest = generateDynamicManifest(user, lists, prefs, orphanListNames);

    const parent = manifest.catalogs.find((c) => c.id === 'letterboxd-list-ext42');
    const variant = manifest.catalogs.find(
      (c) => c.id === 'letterboxd-list-ext42--shuffle',
    );
    expect(parent).toBeUndefined();
    expect(variant).toBeDefined();
    expect(variant?.name).toBe('Horror Classics (Shuffle)');
  });

  it('applies a parent rename to orphan variants of a deleted external list', () => {
    const prefs = basePreferences({
      externalLists: [],
      sortVariants: { 'letterboxd-list-ext42': ['shuffle'] },
      catalogNames: { 'letterboxd-list-ext42': 'My Horror List' },
    });

    const manifest = generateDynamicManifest(user, lists, prefs);

    const variant = manifest.catalogs.find(
      (c) => c.id === 'letterboxd-list-ext42--shuffle',
    );
    expect(variant?.name).toBe('My Horror List (Shuffle)');
  });

  it('keeps orphan variants of a deleted external watchlist (regression #61)', () => {
    const prefs = basePreferences({
      externalWatchlists: [],
      sortVariants: { 'letterboxd-watchlist-bob': ['shuffle'] },
    });

    const manifest = generateDynamicManifest(user, lists, prefs);

    const parent = manifest.catalogs.find((c) => c.id === 'letterboxd-watchlist-bob');
    const variant = manifest.catalogs.find(
      (c) => c.id === 'letterboxd-watchlist-bob--shuffle',
    );
    expect(parent).toBeUndefined();
    expect(variant).toBeDefined();
    expect(variant?.name).toBe("bob's Watchlist (Shuffle)");
  });

  it('expands the rating sort variant on the watchlist (#64)', () => {
    const prefs = basePreferences({
      sortVariants: { 'letterboxd-watchlist': ['rating'] },
    });

    const manifest = generateDynamicManifest(user, lists, prefs);

    const variant = manifest.catalogs.find(
      (c) => c.id === 'letterboxd-watchlist--rating',
    );
    expect(variant).toBeDefined();
    expect(variant?.name).toBe("Alice's Watchlist (By Rating)");
  });

  it('renames orphan variants (parent removed) when parent is renamed via catalogNames', () => {
    // Parent NOT in ownLists, but variant present -> orphan resolved via template map
    const prefs = basePreferences({
      ownLists: [],
      sortVariants: { 'letterboxd-list-abc123': ['shuffle'] },
      catalogNames: { 'letterboxd-list-abc123': 'Renamed Parent' },
    });

    const manifest = generateDynamicManifest(user, lists, prefs);

    const parent = manifest.catalogs.find((c) => c.id === 'letterboxd-list-abc123');
    const variant = manifest.catalogs.find(
      (c) => c.id === 'letterboxd-list-abc123--shuffle',
    );
    expect(parent).toBeUndefined();
    expect(variant).toBeDefined();
    expect(variant?.name).toBe('Renamed Parent (Shuffle)');
  });
});

describe('public manifest description', () => {
  it('points to the supporter page instead of a donation link', () => {
    for (const manifest of [generateBaseManifest(), generatePublicManifest(basePublicCfg({}))]) {
      expect(manifest.description).toBe(PUBLIC_MANIFEST_DESCRIPTION);
      expect(manifest.description).toContain('https://stremboxd.com/pricing');
      expect(manifest.description).not.toMatch(/buymeacoffee|Free forever/i);
    }
  });
});
