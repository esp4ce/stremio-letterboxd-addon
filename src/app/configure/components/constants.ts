import type { BaseCatalogDef } from "./types";

export const ALL_BASE_DEFS: BaseCatalogDef[] = [
  { id: "letterboxd-watchlist", key: "watchlist", label: "Watchlist", description: "Films you want to watch" },
  { id: "letterboxd-diary", key: "diary", label: "Diary", description: "Your recently watched films" },
  { id: "letterboxd-friends", key: "friends", label: "Friends Activity", description: "What your friends are watching" },
  { id: "letterboxd-liked-films", key: "likedFilms", label: "Liked Films", description: "Films you have liked" },
  { id: "letterboxd-recommended", key: "recommended", label: "Recommended", description: "Films recommended based on your taste" },
  { id: "letterboxd-popular", key: "popular", label: "Popular This Week", description: "Trending films on Letterboxd" },
  { id: "letterboxd-top250", key: "top250", label: "Top 250 Narrative Features", description: "Official Top 250 by Dave" },
];

export const SORT_VARIANT_OPTIONS: Array<{ key: string; label: string; description: string }> = [
  { key: 'shuffle', label: 'Shuffle', description: 'Random order each time' },
  { key: 'not-watched', label: 'Not Watched', description: 'Hide films you\'ve seen' },
  { key: 'popular', label: 'Popular', description: 'Sort by popularity' },
];

// Public mode: no auth → no "Not Watched" (requires user's watched history)
export const PUBLIC_SORT_VARIANT_OPTIONS = SORT_VARIANT_OPTIONS.filter((o) => o.key !== 'not-watched');

export const PENCIL_ICON = "M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z";
export const TRASH_PATH = "M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16";

export const CATALOG_KEY_TO_ID: Record<string, string> = {
  watchlist: "letterboxd-watchlist",
  diary: "letterboxd-diary",
  friends: "letterboxd-friends",
  likedFilms: "letterboxd-liked-films",
  recommended: "letterboxd-recommended",
  popular: "letterboxd-popular",
  top250: "letterboxd-top250",
};
