import type { UserPreferences } from "../types/preferences";
import { authHeaders } from "./session-token";

export interface LikedList {
  id: string;
  name: string;
  owner: string;
  filmCount: number;
}

export interface LikedListsPage {
  items: LikedList[];
  /** Absent on the last page */
  cursor?: string;
}

export class LikedListsError extends Error {
  constructor(readonly code: "not_entitled" | "session" | "failed") {
    super(code);
  }
}

export function likedListsBlockedMessage(): string {
  return "Liked lists needs a supporter subscription.";
}

/** Matches the list name or its owner, ignoring case. A blank query keeps everything. */
export function filterLikedLists(items: LikedList[], query: string): LikedList[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return items;
  return items.filter((l) => l.name.toLowerCase().includes(needle) || l.owner.toLowerCase().includes(needle));
}

/** Adds a liked list as an external list. Returns the same object when there is nothing to add. */
export function withLikedList(preferences: UserPreferences, list: LikedList): UserPreferences {
  if (preferences.ownLists.includes(list.id) || preferences.externalLists.some((l) => l.id === list.id)) {
    return preferences;
  }
  return { ...preferences, externalLists: [...preferences.externalLists, list] };
}

export async function fetchLikedLists(backendUrl: string, cursor?: string): Promise<LikedListsPage> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  const res = await fetch(`${backendUrl}/auth/liked-lists${query}`, {
    credentials: "include",
    headers: authHeaders(),
  });
  if (res.status === 401) throw new LikedListsError("session");
  if (res.status === 403) throw new LikedListsError("not_entitled");
  if (!res.ok) throw new LikedListsError("failed");
  return (await res.json()) as LikedListsPage;
}
