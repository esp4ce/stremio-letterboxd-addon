"use client";

import type { UserPreferences } from "../../../types/preferences";
import { Toggle } from "./primitives";

type DisplayOptionsProps =
  | {
      mode: "public";
      showRatings: boolean;
      onShowRatingsChange: (v: boolean) => void;
      hideUnreleased: boolean;
      onHideUnreleasedChange: (v: boolean) => void;
      publicSearch: boolean;
      onPublicSearchChange: (v: boolean) => void;
    }
  | {
      mode: "full";
      preferences: UserPreferences;
      onPreferencesChange: (prefs: UserPreferences) => void;
    };

export function DisplayOptionsSection(props: DisplayOptionsProps) {
  if (props.mode === "public") {
    return (
      <div className="mt-7">
        <h3 className="text-[11px] font-medium uppercase tracking-[0.16em] text-zinc-400">Display Options</h3>
        <div className="mt-3 space-y-2">
          <div className="flex items-center justify-between rounded-lg bg-zinc-800/35 px-3.5 py-3">
            <div>
              <p className="text-[13px] font-medium text-white">Poster Ratings</p>
              <p className="mt-0.5 text-[11px] text-zinc-500">Show Letterboxd ratings on poster images</p>
            </div>
            <Toggle
              enabled={props.showRatings}
              onToggle={() => props.onShowRatingsChange(!props.showRatings)}
            />
          </div>
          <div className="flex items-center justify-between rounded-lg bg-zinc-800/35 px-3.5 py-3">
            <div>
              <p className="text-[13px] font-medium text-white">Hide Unreleased Films</p>
              <p className="mt-0.5 text-[11px] text-zinc-500">Hide films that haven&apos;t been released yet</p>
            </div>
            <Toggle
              enabled={props.hideUnreleased}
              onToggle={() => props.onHideUnreleasedChange(!props.hideUnreleased)}
            />
          </div>
          <div className="flex items-center justify-between rounded-lg bg-zinc-800/35 px-3.5 py-3">
            <div>
              <p className="text-[13px] font-medium text-white">Letterboxd Search</p>
              <p className="mt-0.5 text-[11px] text-zinc-500">Search films directly via Letterboxd in Stremio</p>
            </div>
            <Toggle
              enabled={props.publicSearch}
              onToggle={() => props.onPublicSearchChange(!props.publicSearch)}
            />
          </div>
        </div>
      </div>
    );
  }

  const { preferences, onPreferencesChange } = props;
  const items = [
    { key: "showRatings" as const, label: "Poster Ratings", description: "Show Letterboxd ratings on poster images", defaultOn: true },
    { key: "showActions" as const, label: "Letterboxd Actions", description: "Show rate, watched, liked and watchlist buttons in Stremio", defaultOn: true },
    { key: "showReviews" as const, label: "Popular Reviews", description: "Show popular Letterboxd reviews on film pages", defaultOn: true },
    { key: "hideUnreleased" as const, label: "Hide Unreleased Films", description: "Hide films that haven't been released yet", defaultOn: false },
    { key: "search" as const, label: "Letterboxd Search", description: "Search films directly via Letterboxd in Stremio", defaultOn: true },
  ] as const;

  return (
    <div className="mt-7">
      <h3 className="text-[11px] font-medium uppercase tracking-[0.16em] text-zinc-400">Display Options</h3>
      <div className="mt-3 space-y-2">
        {items.map(({ key, label, description, defaultOn }) => {
          const enabled = defaultOn ? preferences[key] !== false : preferences[key] === true;
          return (
            <div key={key} className="flex items-center justify-between rounded-lg bg-zinc-800/35 px-3.5 py-3">
              <div>
                <p className="text-[13px] font-medium text-white">{label}</p>
                <p className="mt-0.5 text-[11px] text-zinc-500">{description}</p>
              </div>
              <Toggle
                enabled={enabled}
                onToggle={() => onPreferencesChange({ ...preferences, [key]: !enabled })}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
