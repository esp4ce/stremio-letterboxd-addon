"use client";

import Link from "next/link";
import type { UserPreferences } from "../../../types/preferences";
import { browserTimeZone, nativeSyncControl, withNativeSync } from "../../../lib/native-sync";
import { Toggle } from "./primitives";

interface NativeSyncSectionProps {
  preferences: UserPreferences;
  onPreferencesChange: (prefs: UserPreferences) => void;
  entitled: boolean;
}

export function NativeSyncSection({ preferences, onPreferencesChange, entitled }: NativeSyncSectionProps) {
  const control = nativeSyncControl(preferences, entitled);

  return (
    <div className="mt-7">
      <h3 className="text-[11px] font-medium uppercase tracking-[0.16em] text-zinc-400">Native Sync</h3>
      <div className="mt-3 rounded-lg bg-zinc-800/35 px-3.5 py-3">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[13px] font-medium text-white">Log what you watch automatically</p>
            <p className="mt-0.5 text-[11px] text-zinc-500">
              Films you watch past 80% are added to your Letterboxd diary. Films you mark as watched in Stremio are
              marked watched on Letterboxd, without a date.
            </p>
          </div>
          {control.kind === "toggle" ? (
            <Toggle
              enabled={control.enabled}
              onToggle={() => onPreferencesChange(withNativeSync(preferences, control.next, browserTimeZone()))}
            />
          ) : (
            <Link href="/pricing" className="shrink-0 text-[12px] font-medium text-white underline underline-offset-2">
              Supporters
            </Link>
          )}
        </div>
        <p className="mt-2 text-[11px] text-amber-400/80">Your Letterboxd diary is public: everything logged here is visible on your profile.</p>
        <p className="mt-1 text-[11px] text-zinc-500">Works on Stremio Web and Desktop. Android: coming once Stremio updates its app.</p>
      </div>
    </div>
  );
}
