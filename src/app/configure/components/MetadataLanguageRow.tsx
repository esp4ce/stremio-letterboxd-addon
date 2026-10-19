"use client";

import type { UserPreferences } from "../../../types/preferences";
import {
  DEFAULT_METADATA_LANGUAGE,
  METADATA_LANGUAGES,
  metadataLanguageBlockedMessage,
  metadataLanguageControl,
  metadataLanguageLabel,
  withMetadataLanguage,
  type MetadataLanguage,
} from "../../../lib/metadata-language";
import { InfoHint } from "./InfoHint";

interface MetadataLanguageRowProps {
  /** null in public mode, where there is no account to save to */
  preferences: UserPreferences | null;
  onPreferencesChange?: (prefs: UserPreferences) => void;
  signedIn: boolean;
  entitled: boolean;
  /** A language guessed from the member's Stremio account or browser, never applied by itself */
  suggestion?: MetadataLanguage | null;
  /** Called with an explanation when the member cannot pick a language */
  onBlocked: (message: string) => void;
}

const TITLE = "Titles in your language";
const DETAILS =
  "Film titles and synopses in Stremio, from TMDB. Where no translation exists, English is kept. Posters, audio and subtitles don't change.";

const controlClass =
  "h-9 w-full sm:w-[9.5rem] appearance-none truncate rounded-control border border-line-strong bg-background pr-8 pl-3 text-left text-[14px] text-foreground transition-colors hover:border-control focus:outline-none focus-visible:ring-1 focus-visible:ring-control";

function Chevron() {
  return (
    <svg
      className="pointer-events-none absolute top-1/2 right-3 h-3.5 w-3.5 -translate-y-1/2 text-dim"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path d="M6 9l6 6 6-6" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function MetadataLanguageRow({
  preferences,
  onPreferencesChange,
  signedIn,
  entitled,
  suggestion,
  onBlocked,
}: MetadataLanguageRowProps) {
  const control = metadataLanguageControl(preferences, { signedIn, entitled });

  const choose = (language: string) => {
    if (preferences && onPreferencesChange) onPreferencesChange(withMetadataLanguage(preferences, language));
  };

  const showSuggestion = control.kind === "select" && control.value === DEFAULT_METADATA_LANGUAGE && !!suggestion;

  return (
    // A picker is wider than a toggle: on narrow screens it wraps under the text instead of squeezing it.
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 rounded-control bg-raised px-4 py-3.5">
      <div className="min-w-0 flex-1 basis-52">
        <InfoHint title={TITLE} label={`About ${TITLE.toLowerCase()}`} details={DETAILS} />
        {showSuggestion ? (
          <p className="mt-0.5 text-[14px] text-dim">
            Suggested:{" "}
            <button
              type="button"
              onClick={() => choose(suggestion)}
              className="rounded-sm text-foreground underline decoration-line-strong underline-offset-4 transition-colors hover:decoration-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-control"
            >
              {metadataLanguageLabel(suggestion)}
            </button>
          </p>
        ) : (
          <p className="mt-0.5 text-[14px] text-dim">Film titles and synopses in Stremio</p>
        )}
      </div>

      <div className="relative w-full sm:w-auto sm:flex-shrink-0">
        {control.kind === "select" ? (
          <select
            value={control.value}
            onChange={(e) => choose(e.target.value)}
            aria-label={TITLE}
            className={controlClass}
          >
            {METADATA_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        ) : (
          // Same look as the picker, but opening it explains what unlocks it.
          <button
            type="button"
            onClick={() => onBlocked(metadataLanguageBlockedMessage(control.reason))}
            aria-label={`${TITLE}: English. ${metadataLanguageBlockedMessage(control.reason)}`}
            className={controlClass}
          >
            English
          </button>
        )}
        <Chevron />
      </div>
    </div>
  );
}
