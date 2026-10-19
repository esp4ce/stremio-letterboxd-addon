"use client";

import type { UserPreferences } from "../../../types/preferences";
import { browserTimeZone, nativeSyncBlockedMessage, nativeSyncControl, withNativeSync } from "../../../lib/native-sync";
import { InfoHint } from "./InfoHint";
import { Toggle } from "./primitives";

interface NativeSyncRowProps {
  /** null in public mode, where there is no account to write with */
  preferences: UserPreferences | null;
  onPreferencesChange?: (prefs: UserPreferences) => void;
  signedIn: boolean;
  entitled: boolean;
  /** Called with an explanation when the member cannot turn it on */
  onBlocked: (message: string) => void;
}

const DETAILS =
  "Watch 80% of a film in Stremio and it's added to your public Letterboxd diary. Web and Desktop only for now.";

export function NativeSyncRow({ preferences, onPreferencesChange, signedIn, entitled, onBlocked }: NativeSyncRowProps) {
  const control = nativeSyncControl(preferences, { signedIn, entitled });

  const onToggle = () => {
    if (control.kind === "blocked") {
      onBlocked(nativeSyncBlockedMessage(control.reason));
      return;
    }
    if (preferences && onPreferencesChange) {
      onPreferencesChange(withNativeSync(preferences, control.next, browserTimeZone()));
    }
  };

  return (
    <div className="flex items-center justify-between gap-4 rounded-control bg-raised px-4 py-3.5">
      <div className="min-w-0">
        <InfoHint title="Auto-log to Diary" label="About Auto-log to Diary" details={DETAILS} />
        <p className="mt-0.5 text-[14px] text-dim">Films watched in Stremio land in your public diary</p>
      </div>
      <Toggle enabled={control.kind === "toggle" && control.enabled} onToggle={onToggle} label="Auto-log to Diary" />
    </div>
  );
}
