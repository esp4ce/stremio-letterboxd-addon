"use client";

import TransitionLink from "../../components/TransitionLink";
import type { UserPreferences } from "../../../types/preferences";
import { browserTimeZone, nativeSyncControl, withNativeSync } from "../../../lib/native-sync";
import { Toggle } from "./primitives";

interface NativeSyncRowProps {
  preferences: UserPreferences;
  onPreferencesChange: (prefs: UserPreferences) => void;
  entitled: boolean;
}

const DETAILS =
  "Films you watch past 80% are added to your Letterboxd diary, dated today. Films you mark as watched in Stremio are marked watched, without a diary entry. Your diary is public. Works on Stremio Web and Desktop. Android: coming once Stremio updates its app.";

export function NativeSyncRow({ preferences, onPreferencesChange, entitled }: NativeSyncRowProps) {
  const control = nativeSyncControl(preferences, entitled);

  return (
    <div className="flex items-center justify-between gap-4 rounded-lg bg-zinc-800/35 px-3.5 py-3">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="text-[13px] font-medium text-white">Auto-log to Diary</p>
          <span
            className="flex h-3.5 w-3.5 cursor-help items-center justify-center text-zinc-600 transition-colors hover:text-zinc-300"
            title={DETAILS}
            aria-label={DETAILS}
          >
            <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="9" strokeWidth={2} />
              <path d="M12 16v-4.5M12 8h.01" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </div>
        <p className="mt-0.5 text-[11px] text-zinc-500">Films watched in Stremio land in your public diary</p>
      </div>
      {control.kind === "toggle" ? (
        <Toggle
          enabled={control.enabled}
          onToggle={() => onPreferencesChange(withNativeSync(preferences, control.next, browserTimeZone()))}
        />
      ) : (
        <TransitionLink
          href="/pricing"
          direction="up"
          className="flex-shrink-0 whitespace-nowrap rounded-full border border-zinc-700 px-2.5 py-1 text-[10.5px] font-semibold text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white"
        >
          Supporters
        </TransitionLink>
      )}
    </div>
  );
}
