import { config, tmdbConfig } from '../../config/index.js';
import { GENRE_NAMES } from '../letterboxd/letterboxd.client.js';
import type { UserList } from '../letterboxd/letterboxd.client.js';
import type { UserPreferences } from '../../db/repositories/user.repository.js';
import type { PublicConfig } from '../../lib/config-encoding.js';

// Stremio Addons verification
const STREMIO_ADDONS_CONFIG = {
  issuer: 'https://stremio-addons.net',
  signature: 'eyJhbGciOiJkaXIiLCJlbmMiOiJBMTI4Q0JDLUhTMjU2In0..I3PvePmUVrvubt0Oc0VHyw.JDBRxiddKlxnfCOo7WofztIGnkmzfUnbQeKoJEvwfGGArc1sg_m0fW24oy2XXIq_Ew8RWpPbQAoDUKculia_JFgBLck-p3VQ3gVXmsTPDdGsw1J_y26kYEIaFkQIp7Hd.4iM2G42fBrSjtYFS2bz5vQ',
};

export interface StremioResourceDescriptor {
  name: string;
  types: string[];
  idPrefixes?: string[];
}

export interface StremioManifest {
  id: string;
  version: string;
  name: string;
  description: string;
  logo: string;
  background: string;
  resources: (string | StremioResourceDescriptor)[];
  types: string[];
  idPrefixes?: string[];
  catalogs: StremioCatalog[];
  behaviorHints: {
    configurable: boolean;
    configurationRequired: boolean;
  };
  stremioAddonsConfig?: {
    issuer: string;
    signature: string;
  };
}

export interface StremioCatalog {
  type: string;
  id: string;
  name: string;
  extra?: Array<{
    name: string;
    isRequired?: boolean;
    options?: string[];
    optionsLimit?: number;
  }>;
}


export const SORT_LABEL_TO_API: Record<string, string> = {
  "Recently Added": "DateLatestFirst",
  "Oldest Added": "DateEarliestFirst",
  "Film Name": "FilmName",
  "Release Date (Newest)": "ReleaseDateLatestFirst",
  "Release Date (Oldest)": "ReleaseDateEarliestFirst",
  "Your Rating (High)": "AuthenticatedMemberRatingHighToLow",
  "Your Rating (Low)": "AuthenticatedMemberRatingLowToHigh",
  "Average Rating (High)": "AverageRatingHighToLow",
  "Average Rating (Low)": "AverageRatingLowToHigh",
  "Popularity": "FilmPopularity",
  "Popularity (Week)": "FilmPopularityThisWeek",
  "Popularity (Month)": "FilmPopularityThisMonth",
  "Shortest": "FilmDurationShortestFirst",
  "Longest": "FilmDurationLongestFirst",
};

const DECADE_OPTIONS = ['2020s', '2010s', '2000s', '1990s', '1980s', '1970s', '1960s', '1950s', '1940s', '1930s', '1920s'];

// Combined filter: Sort → Genres → Decades (single dropdown, well organized)
const SORT_OPTIONS = [
  "Recently Added", "Oldest Added", "Film Name",
  "Release Date (Newest)", "Release Date (Oldest)",
  "Your Rating (High)", "Your Rating (Low)",
  "Average Rating (High)", "Average Rating (Low)",
  "Popularity", "Popularity (Week)", "Popularity (Month)",
  "Shortest", "Longest",
  "Shuffle",
  "Not Watched",
  "Released Only",
];
const PUBLIC_SORT_OPTIONS = SORT_OPTIONS.filter(
  (o) => o !== "Your Rating (High)" && o !== "Your Rating (Low)" && o !== "Not Watched"
);

const COMBINED_EXTRA = { name: 'genre', options: [...SORT_OPTIONS, ...GENRE_NAMES, ...DECADE_OPTIONS], isRequired: false, optionsLimit: 1 };
const PUBLIC_COMBINED_EXTRA = { name: 'genre', options: [...PUBLIC_SORT_OPTIONS, ...GENRE_NAMES, ...DECADE_OPTIONS], isRequired: false, optionsLimit: 1 };

const SEARCH_CATALOG: StremioCatalog = {
  type: 'movie',
  id: 'letterboxd-search',
  name: 'Search Letterboxd',
  extra: [{ name: 'search', isRequired: true }],
};

// Sort variant definitions (only high-value variants that justify a separate catalog)
export const SORT_VARIANT_KEYS: Record<string, { label: string; sort?: string; special?: 'shuffle' | 'notWatched' }> = {
  'shuffle': { label: 'Shuffle', special: 'shuffle' },
  'not-watched': { label: 'Not Watched', special: 'notWatched' },
  'popular': { label: 'Popular', sort: 'FilmPopularity' },
  'rating': { label: 'By Rating', sort: 'AverageRatingHighToLow' },
};

function expandWithSortVariants(catalogs: StremioCatalog[], sortVariants: Record<string, string[]>, allCatalogTemplates?: StremioCatalog[]): StremioCatalog[] {
  if (!Object.keys(sortVariants).length) return catalogs;
  const result: StremioCatalog[] = [];
  const catalogMap = new Map(catalogs.map(c => [c.id, c]));

  // Also index templates for catalogs that might not be in the active list
  const templateMap = new Map<string, StremioCatalog>();
  if (allCatalogTemplates) {
    for (const t of allCatalogTemplates) templateMap.set(t.id, t);
  }

  // Add active catalogs with their variants inline
  for (const cat of catalogs) {
    result.push(cat);
    const variants = sortVariants[cat.id];
    if (variants) {
      for (const key of variants) {
        const variant = SORT_VARIANT_KEYS[key];
        if (variant) {
          result.push({
            ...cat,
            id: `${cat.id}--${key}`,
            name: `${cat.name} (${variant.label})`,
          });
        }
      }
    }
  }

  // Add orphan variants (base catalog disabled but variant enabled)
  for (const [catalogId, keys] of Object.entries(sortVariants)) {
    if (catalogMap.has(catalogId)) continue; // already handled above
    const template = templateMap.get(catalogId);
    if (!template) continue;
    for (const key of keys) {
      const variant = SORT_VARIANT_KEYS[key];
      if (variant) {
        result.push({
          ...template,
          id: `${template.id}--${key}`,
          name: `${template.name} (${variant.label})`,
        });
      }
    }
  }

  return result;
}

function synthesizeOrphanTemplate(
  baseId: string,
  extra: StremioCatalog['extra'],
  names: {
    displayName?: string;
    hasUsername?: boolean;
    listNames?: Map<string, string>;
    watchlistNames?: Map<string, string>;
    contributorNames?: Map<string, string>;
  }
): StremioCatalog | null {
  let name: string | null = null;
  if (baseId === 'letterboxd-popular') {
    name = 'Popular This Week';
  } else if (baseId === 'letterboxd-top250') {
    name = 'Top 250 Narrative Features';
  } else if (baseId === 'letterboxd-watchlist') {
    name = names.hasUsername ? (names.displayName ? `${names.displayName}'s Watchlist` : 'Watchlist') : null;
  } else if (baseId === 'letterboxd-liked-films') {
    name = names.hasUsername ? (names.displayName ? `${names.displayName}'s Liked Films` : 'Liked Films') : null;
  } else if (baseId.startsWith('letterboxd-watchlist-')) {
    const username = baseId.slice('letterboxd-watchlist-'.length);
    name = `${names.watchlistNames?.get(username) || username}'s Watchlist`;
  } else if (baseId.startsWith('letterboxd-list-')) {
    const listId = baseId.slice('letterboxd-list-'.length);
    name = names.listNames?.get(listId) || `List ${listId}`;
  } else if (baseId.startsWith('letterboxd-contributor-')) {
    const rest = baseId.slice('letterboxd-contributor-'.length);
    const sep = rest.indexOf('-');
    if (sep > 0) {
      const t = rest.slice(0, sep);
      const id = rest.slice(sep + 1);
      name = names.contributorNames?.get(`${t}:${id}`) || `Contributor ${id}`;
    }
  }
  if (!name) return null;
  return { type: 'movie', id: baseId, name, extra };
}

const RECO_SORT_OPTIONS = [
  "Film Name",
  "Release Date (Newest)", "Release Date (Oldest)",
  "Average Rating (High)", "Average Rating (Low)",
  "Shuffle",
  "Not Watched",
];
export const RECO_SORT_EXTRA = { name: 'genre', options: [...RECO_SORT_OPTIONS, ...GENRE_NAMES, ...DECADE_OPTIONS], isRequired: false, optionsLimit: 1 };

/**
 * Generate base catalogs for a user
 */
function getBaseCatalogs(displayName: string): StremioCatalog[] {
  return [
    {
      type: 'movie',
      id: 'letterboxd-watchlist',
      name: `${displayName}'s Watchlist`,
      extra: [COMBINED_EXTRA, { name: 'skip', isRequired: false }],
    },
    {
      type: 'movie',
      id: 'letterboxd-diary',
      name: `${displayName}'s Recent Diary`,
      extra: [COMBINED_EXTRA, { name: 'skip', isRequired: false }],
    },
    {
      type: 'movie',
      id: 'letterboxd-friends',
      name: `${displayName}'s Friends Activity`,
      extra: [{ name: 'skip', isRequired: false }],
    },
    {
      type: 'movie',
      id: 'letterboxd-liked-films',
      name: `${displayName}'s Liked Films`,
      extra: [COMBINED_EXTRA, { name: 'skip', isRequired: false }],
    },
    ...(tmdbConfig.apiKey
      ? [
          {
            type: 'movie' as const,
            id: 'letterboxd-recommended',
            name: `Recommended for ${displayName}`,
            extra: [RECO_SORT_EXTRA, { name: 'skip', isRequired: false }],
          },
        ]
      : []),
    {
      type: 'movie',
      id: 'letterboxd-popular',
      name: 'Popular This Week',
      extra: [COMBINED_EXTRA, { name: 'skip', isRequired: false }],
    },
    {
      type: 'movie',
      id: 'letterboxd-top250',
      name: 'Top 250 Narrative Features',
      extra: [COMBINED_EXTRA, { name: 'skip', isRequired: false }],
    },
  ];
}

const catalogIdMap: Record<string, keyof UserPreferences['catalogs']> = {
  'letterboxd-watchlist': 'watchlist',
  'letterboxd-diary': 'diary',
  'letterboxd-friends': 'friends',
  'letterboxd-liked-films': 'likedFilms',
  'letterboxd-recommended': 'recommended',
  'letterboxd-popular': 'popular',
  'letterboxd-top250': 'top250',
};

/**
 * Convert user lists to Stremio catalogs
 */
function listsToStremioCatalogs(lists: UserList[]): StremioCatalog[] {
  return lists.map((list) => ({
    type: 'movie',
    id: `letterboxd-list-${list.id}`,
    name: list.name,
    extra: [COMBINED_EXTRA, { name: 'skip', isRequired: false }],
  }));
}

/**
 * Generate base manifest for stremio-addons.net submission (Tier 1)
 * Only includes generic catalogs: Popular + Top 250
 */
export function generateBaseManifest(): StremioManifest {
  return {
    id: 'community.stremboxd',
    version: '1.2.3',
    name: 'Stremboxd',
    description: 'Letterboxd for Stremio: popular films, Top 250, watchlist, custom lists, genre & decade filters, and search. Configure at https://stremboxd.com. Free forever — donations welcome: https://buymeacoffee.com/esp4ce',
    logo: `${config.PUBLIC_URL}/logo.png`,
    background: `${config.PUBLIC_URL}/background.jpg`,
    resources: [
      'catalog',
      {
        name: 'meta',
        types: ['movie'],
        idPrefixes: ['tt'],
      },
    ],
    types: ['movie'],
    catalogs: [
      {
        type: 'movie',
        id: 'letterboxd-popular',
        name: 'Popular This Week',
        extra: [PUBLIC_COMBINED_EXTRA, { name: 'skip', isRequired: false }],
      },
      {
        type: 'movie',
        id: 'letterboxd-top250',
        name: 'Top 250 Narrative Features',
        extra: [PUBLIC_COMBINED_EXTRA, { name: 'skip', isRequired: false }],
      },
      SEARCH_CATALOG,
    ],
    behaviorHints: {
      configurable: true,
      configurationRequired: false,
    },
    stremioAddonsConfig: STREMIO_ADDONS_CONFIG,
  };
}

/**
 * Generate public manifest for Tier 2 (config-based, no auth)
 */
export function generatePublicManifest(
  cfg: PublicConfig,
  displayName?: string,
  listNames?: Map<string, string>,
  watchlistNames?: Map<string, string>,
  contributorNames?: Map<string, string>
): StremioManifest {
  let catalogs: StremioCatalog[] = [];

  if (cfg.c.popular) {
    catalogs.push({
      type: 'movie',
      id: 'letterboxd-popular',
      name: 'Popular This Week',
      extra: [PUBLIC_COMBINED_EXTRA, { name: 'skip', isRequired: false }],
    });
  }

  if (cfg.c.top250) {
    catalogs.push({
      type: 'movie',
      id: 'letterboxd-top250',
      name: 'Top 250 Narrative Features',
      extra: [PUBLIC_COMBINED_EXTRA, { name: 'skip', isRequired: false }],
    });
  }

  if (cfg.u && cfg.c.watchlist) {
    const watchlistName = displayName ? `${displayName}'s Watchlist` : 'Watchlist';
    catalogs.push({
      type: 'movie',
      id: 'letterboxd-watchlist',
      name: watchlistName,
      extra: [PUBLIC_COMBINED_EXTRA, { name: 'skip', isRequired: false }],
    });
  }

  if (cfg.u && cfg.c.likedFilms) {
    const likedName = displayName ? `${displayName}'s Liked Films` : 'Liked Films';
    catalogs.push({
      type: 'movie',
      id: 'letterboxd-liked-films',
      name: likedName,
      extra: [PUBLIC_COMBINED_EXTRA, { name: 'skip', isRequired: false }],
    });
  }

  for (const listId of cfg.l) {
    catalogs.push({
      type: 'movie',
      id: `letterboxd-list-${listId}`,
      name: listNames?.get(listId) || `List ${listId}`,
      extra: [PUBLIC_COMBINED_EXTRA, { name: 'skip', isRequired: false }],
    });
  }

  if (cfg.f?.length) {
    for (const entry of cfg.f) {
      const key = `${entry.t}:${entry.id}`;
      catalogs.push({
        type: 'movie',
        id: `letterboxd-contributor-${entry.t}-${entry.id}`,
        name: contributorNames?.get(key) || `Contributor ${entry.id}`,
        extra: [PUBLIC_COMBINED_EXTRA, { name: 'skip', isRequired: false }],
      });
    }
  }

  // External watchlists
  if (cfg.w) {
    for (const username of cfg.w) {
      const extDisplayName = watchlistNames?.get(username) || username;
      catalogs.push({
        type: 'movie',
        id: `letterboxd-watchlist-${username}`,
        name: `${extDisplayName}'s Watchlist`,
        extra: [PUBLIC_COMBINED_EXTRA, { name: 'skip', isRequired: false }],
      });
    }
  }

  // Apply custom catalog names to parents BEFORE expansion so variants inherit the
  // renamed parent in their generated name (e.g. "My List (Shuffle)").
  if (cfg.n) {
    for (const cat of catalogs) {
      const customName = cfg.n[cat.id];
      if (customName) cat.name = customName;
    }
  }

  // Save all catalogs as templates before reordering (for orphan variant support).
  // Templates capture the renamed parent so orphan variants also inherit the custom name.
  const allPublicTemplates = [...catalogs];

  if (cfg.s) {
    const templateIds = new Set(allPublicTemplates.map((t) => t.id));
    for (const baseId of Object.keys(cfg.s)) {
      if (templateIds.has(baseId)) continue;
      const synthesized = synthesizeOrphanTemplate(
        baseId,
        [PUBLIC_COMBINED_EXTRA, { name: 'skip', isRequired: false }],
        { displayName, hasUsername: !!cfg.u, listNames, watchlistNames, contributorNames },
      );
      if (!synthesized) continue;
      const customName = cfg.n?.[baseId];
      if (customName) synthesized.name = customName;
      allPublicTemplates.push(synthesized);
    }
  }

  // Apply catalog ordering from config
  if (cfg.o?.length) {
    const remaining = new Map(catalogs.map((c) => [c.id, c]));
    const ordered: StremioCatalog[] = [];
    for (const id of cfg.o) {
      const cat = remaining.get(id);
      if (cat) { ordered.push(cat); remaining.delete(id); }
    }
    catalogs = [...ordered, ...remaining.values()];
  }

  // Expand sort variants for public config
  catalogs = expandWithSortVariants(catalogs, cfg.s || {}, allPublicTemplates);

  // Re-apply custom catalog names AFTER expansion so variant-specific overrides win
  // (e.g. cfg.n["letterboxd-list-XXX--shuffle"] = "My Shuffled List").
  if (cfg.n) {
    for (const cat of catalogs) {
      const customName = cfg.n[cat.id];
      if (customName) cat.name = customName;
    }
  }

  if (cfg.q !== false) catalogs.push(SEARCH_CATALOG);

  const namePart = displayName ? ` for ${displayName}` : '';

  return {
    id: 'community.stremboxd',
    version: '1.2.3',
    name: `Stremboxd${namePart}`,
    description: 'Letterboxd for Stremio: popular films, Top 250, watchlist, custom lists, genre & decade filters, and search. Configure at https://stremboxd.com. Free forever — donations welcome: https://buymeacoffee.com/esp4ce',
    logo: `${config.PUBLIC_URL}/logo.png`,
    background: `${config.PUBLIC_URL}/background.jpg`,
    resources: [
      'catalog',
      {
        name: 'meta',
        types: ['movie'],
        idPrefixes: ['tt'],
      },
    ],
    types: ['movie'],
    catalogs,
    behaviorHints: {
      configurable: true,
      configurationRequired: false,
    },
  };
}

/**
 * Generate static manifest (without user lists)
 */
export function generateManifest(user: {
  username: string;
  displayName?: string | null;
}): StremioManifest {
  const displayName = user.displayName || user.username;

  return {
    id: 'community.stremboxd',
    version: '1.2.3',
    name: `Letterboxd for ${displayName}`,
    description: `Your personal Letterboxd ratings and watchlist synced to Stremio. Connected as ${user.username}.`,
    logo: `${config.PUBLIC_URL}/logo.png`,
    background: `${config.PUBLIC_URL}/background.jpg`,
    resources: [
      'catalog',
      {
        name: 'stream',
        types: ['movie'],
      },
      {
        name: 'meta',
        types: ['movie'],
        idPrefixes: ['tt'],
      },
    ],
    types: ['movie'],
    catalogs: [...getBaseCatalogs(displayName), SEARCH_CATALOG],
    behaviorHints: {
      configurable: true,
      configurationRequired: false,
    },
    stremioAddonsConfig: STREMIO_ADDONS_CONFIG,
  };
}

/**
 * Generate dynamic manifest with user's lists, filtered by preferences
 */
export function generateDynamicManifest(
  user: {
    username: string;
    displayName?: string | null;
  },
  lists: UserList[],
  preferences?: UserPreferences | null,
  orphanListNames?: Map<string, string>
): StremioManifest {
  const displayName = user.displayName || user.username;
  const baseCatalogs = getBaseCatalogs(displayName);

  let catalogs: StremioCatalog[];

  if (preferences) {
    // Filter base catalogs according to preferences
    const filteredBase = baseCatalogs.filter((cat) => {
      const prefKey = catalogIdMap[cat.id];
      return prefKey ? (preferences.catalogs[prefKey] ?? true) : true;
    });

    // Filter own lists according to preferences
    const filteredOwnLists = lists.filter((l) =>
      preferences.ownLists.includes(l.id)
    );
    const ownListCatalogs = listsToStremioCatalogs(filteredOwnLists);

    // Add external lists from preferences
    const externalListCatalogs: StremioCatalog[] =
      preferences.externalLists.map((ext) => ({
        type: 'movie',
        id: `letterboxd-list-${ext.id}`,
        name: `${ext.name} (${ext.owner})`,
        extra: [COMBINED_EXTRA, { name: 'skip', isRequired: false }],
      }));

    // Add external watchlists from preferences
    const externalWatchlistCatalogs: StremioCatalog[] =
      (preferences.externalWatchlists || []).map((ext) => ({
        type: 'movie',
        id: `letterboxd-watchlist-${ext.username}`,
        name: `${ext.displayName}'s Watchlist`,
        extra: [COMBINED_EXTRA, { name: 'skip', isRequired: false }],
      }));

    const contributorCatalogs: StremioCatalog[] = (preferences.contributors || []).map((c) => ({
      type: 'movie',
      id: `letterboxd-contributor-${c.t}-${c.id}`,
      name: c.name,
      extra: [COMBINED_EXTRA, { name: 'skip', isRequired: false }],
    }));

    catalogs = [...filteredBase, ...ownListCatalogs, ...externalListCatalogs, ...externalWatchlistCatalogs, ...contributorCatalogs];

    // Apply catalog ordering
    if (preferences.catalogOrder?.length) {
      const knownIds = new Set(catalogs.map((c) => c.id));
      const validOrder = preferences.catalogOrder.filter((id) => knownIds.has(id));
      const remaining = new Map(catalogs.map((c) => [c.id, c]));
      const ordered: StremioCatalog[] = [];
      for (const id of validOrder) {
        const cat = remaining.get(id);
        if (cat) { ordered.push(cat); remaining.delete(id); }
      }
      catalogs = [...ordered, ...remaining.values()];
    }

    // Apply custom catalog names to parents BEFORE expansion so variants inherit the
    // renamed parent in their generated "<name> (<variant>)" label.
    if (preferences.catalogNames) {
      for (const cat of catalogs) {
        const customName = preferences.catalogNames[cat.id];
        if (customName) cat.name = customName;
      }
    }
  } else {
    // No preferences: include everything (backwards compatible)
    const listCatalogs = listsToStremioCatalogs(lists);
    catalogs = [...baseCatalogs, ...listCatalogs];
  }

  // Expand sort variants (pass all possible catalogs as templates for orphan variants)
  const allListCatalogs = listsToStremioCatalogs(lists);
  const allTemplates = [...baseCatalogs, ...allListCatalogs];
  if (preferences) {
    for (const ext of preferences.externalLists) {
      allTemplates.push({ type: 'movie', id: `letterboxd-list-${ext.id}`, name: `${ext.name} (${ext.owner})`, extra: [COMBINED_EXTRA, { name: 'skip', isRequired: false }] });
    }
    for (const ext of preferences.externalWatchlists || []) {
      allTemplates.push({ type: 'movie', id: `letterboxd-watchlist-${ext.username}`, name: `${ext.displayName}'s Watchlist`, extra: [COMBINED_EXTRA, { name: 'skip', isRequired: false }] });
    }
    for (const c of preferences.contributors || []) {
      allTemplates.push({ type: 'movie', id: `letterboxd-contributor-${c.t}-${c.id}`, name: c.name, extra: [COMBINED_EXTRA, { name: 'skip', isRequired: false }] });
    }
    if (preferences.sortVariants) {
      const templateIds = new Set(allTemplates.map((t) => t.id));
      for (const baseId of Object.keys(preferences.sortVariants)) {
        if (templateIds.has(baseId)) continue;
        const synthesized = synthesizeOrphanTemplate(
          baseId,
          [COMBINED_EXTRA, { name: 'skip', isRequired: false }],
          { listNames: orphanListNames },
        );
        if (synthesized) allTemplates.push(synthesized);
      }
    }
  }
  // Propagate parent renames to templates so orphan variants also inherit custom names.
  if (preferences?.catalogNames) {
    for (const tpl of allTemplates) {
      const customName = preferences.catalogNames[tpl.id];
      if (customName) tpl.name = customName;
    }
  }

  catalogs = expandWithSortVariants(catalogs, preferences?.sortVariants || {}, allTemplates);

  // Re-apply custom catalog names AFTER expansion so variant-specific overrides win
  // (e.g. catalogNames["letterboxd-list-XXX--shuffle"] = "My Shuffled List").
  if (preferences?.catalogNames) {
    for (const cat of catalogs) {
      const customName = preferences.catalogNames[cat.id];
      if (customName) cat.name = customName;
    }
  }

  if (preferences?.search !== false) catalogs.push(SEARCH_CATALOG);

  const exposeStreams =
    !preferences || preferences.showRatings !== false || preferences.showActions !== false;

  const resources: (string | StremioResourceDescriptor)[] = ['catalog'];
  if (exposeStreams) {
    resources.push({ name: 'stream', types: ['movie'] });
  }
  resources.push({ name: 'meta', types: ['movie'], idPrefixes: ['tt'] });

  return {
    id: 'community.stremboxd',
    version: '1.2.3',
    name: `Letterboxd for ${displayName}`,
    description: `Your personal Letterboxd ratings and watchlist synced to Stremio. Connected as ${user.username}.`,
    logo: `${config.PUBLIC_URL}/logo.png`,
    background: `${config.PUBLIC_URL}/background.jpg`,
    resources,
    types: ['movie'],
    catalogs,
    behaviorHints: {
      configurable: true,
      configurationRequired: false,
    },
    stremioAddonsConfig: STREMIO_ADDONS_CONFIG,
  };
}

