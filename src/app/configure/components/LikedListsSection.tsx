"use client";

import { useState } from "react";
import {
  fetchLikedLists,
  filterLikedLists,
  LikedListsError,
  likedListsBlockedMessage,
  type LikedList,
} from "../../../lib/liked-lists";

interface LikedListsSectionProps {
  backendUrl: string;
  entitled: boolean;
  /** Already a catalog, as an external list or as one of the member's own lists */
  isIncluded: (listId: string) => boolean;
  /** The member's own list: already offered in their lists, so it cannot be added twice */
  isOwned: (listId: string) => boolean;
  onAdd: (list: LikedList) => void;
  onRemove: (listId: string) => void;
  /** Called with an explanation when the member cannot use it */
  onBlocked: (message: string) => void;
}

type LoadError = "not_entitled" | "session" | "failed";

const ERROR_TEXT: Record<LoadError, string> = {
  not_entitled: likedListsBlockedMessage(),
  session: "Your session expired. Use another account, then sign in again.",
  failed: "Couldn't load your liked lists.",
};

const CHEVRON = (
  <svg
    className="h-4 w-4 transition-transform group-open:rotate-180"
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M19 9l-7 7-7-7" />
  </svg>
);

export function LikedListsSection({
  backendUrl,
  entitled,
  isIncluded,
  isOwned,
  onAdd,
  onRemove,
  onBlocked,
}: LikedListsSectionProps) {
  const [items, setItems] = useState<LikedList[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<LoadError | null>(null);
  const [query, setQuery] = useState("");
  const [started, setStarted] = useState(false);

  const load = async (next?: string) => {
    setLoading(true);
    setError(null);
    try {
      const page = await fetchLikedLists(backendUrl, next);
      // Pages can overlap when a list is liked between two requests.
      setItems((prev) => {
        const seen = new Set(prev.map((l) => l.id));
        return [...prev, ...page.items.filter((l) => !seen.has(l.id))];
      });
      setCursor(page.cursor);
    } catch (err) {
      setError(err instanceof LikedListsError ? err.code : "failed");
    } finally {
      setLoading(false);
    }
  };

  // Nothing is requested until the member opens the section: most visits never need it.
  const onToggle = (e: React.SyntheticEvent<HTMLDetailsElement>) => {
    if (!e.currentTarget.open || started) return;
    setStarted(true);
    void load();
  };

  if (!entitled) {
    return (
      <button
        type="button"
        aria-disabled="true"
        onClick={() => onBlocked(likedListsBlockedMessage())}
        className="flex w-full items-center justify-between gap-3 rounded-card border border-line px-4 py-3.5 text-left opacity-60 transition-opacity hover:opacity-80"
      >
        <span className="min-w-0">
          <span className="block text-[16px] font-medium">Lists you liked on Letterboxd</span>
          <span className="mt-0.5 block text-[14px] font-normal text-dim">Pick the ones you want in Stremio</span>
        </span>
        <span className="shrink-0 rounded-control bg-raised px-2.5 py-1 font-mono text-[12px] text-muted">Supporter</span>
      </button>
    );
  }

  const visible = filterLikedLists(items, query);
  const loaded = started && !loading && !error;

  return (
    <details className="group rounded-card border border-line" onToggle={onToggle}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3.5 text-[16px] font-medium [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 truncate">Lists you liked on Letterboxd</span>
        <span className="flex shrink-0 items-center text-dim">{CHEVRON}</span>
      </summary>

      <div className="border-t border-line p-4">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by list or author"
          aria-label="Search your liked lists"
          autoComplete="off"
          spellCheck={false}
          className="field-input"
        />

        <div role="status" aria-live="polite">
          {loading && items.length === 0 && <p className="mt-3 text-[14px] text-dim">Loading your liked lists…</p>}
          {error && (
            <p className="mt-3 text-[14px] text-dim">
              {ERROR_TEXT[error]}{" "}
              {error === "failed" && (
                <button type="button" onClick={() => void load(cursor)} className="link-quiet inline text-[14px]">
                  Try again
                </button>
              )}
            </p>
          )}
          {loaded && items.length === 0 && (
            <p className="mt-3 text-[14px] text-dim">You haven&apos;t liked any list on Letterboxd yet.</p>
          )}
          {loaded && items.length > 0 && visible.length === 0 && (
            <p className="mt-3 text-[14px] text-dim">No loaded list matches. Load more to search further.</p>
          )}
        </div>

        {visible.length > 0 && (
          <div className="config-scroll mt-3 grid max-h-[40dvh] grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-3">
            {visible.map((list) => {
              const owned = isOwned(list.id);
              return (
                <label
                  key={list.id}
                  className={`flex items-center gap-3 rounded-control bg-raised px-3.5 py-2.5 ${owned ? "opacity-60" : "cursor-pointer"}`}
                >
                  <input
                    type="checkbox"
                    checked={isIncluded(list.id)}
                    disabled={owned}
                    onChange={(e) => (e.target.checked ? onAdd(list) : onRemove(list.id))}
                    aria-label={`Include ${list.name}`}
                    className="h-6 w-6 shrink-0 rounded-control border-control bg-line-strong text-foreground accent-white"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] text-foreground">{list.name}</span>
                    <span className="block truncate text-[12px] text-dim">
                      {owned ? "Already in your lists" : `by ${list.owner}`}
                    </span>
                  </span>
                  <span className="shrink-0 text-[12px] text-dim">{list.filmCount}</span>
                </label>
              );
            })}
          </div>
        )}

        {cursor && !error && (
          <button
            type="button"
            onClick={() => void load(cursor)}
            disabled={loading}
            className="btn btn-ghost mt-3 h-11 w-full"
          >
            {loading ? "Loading…" : "Load more"}
          </button>
        )}
      </div>
    </details>
  );
}
