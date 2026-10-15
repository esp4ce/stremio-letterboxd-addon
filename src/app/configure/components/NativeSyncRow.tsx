"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { UserPreferences } from "../../../types/preferences";
import { browserTimeZone, nativeSyncBlockedMessage, nativeSyncControl, withNativeSync } from "../../../lib/native-sync";
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
  // A title attribute never shows on touch screens, so the details live in a
  // bubble opened by tapping the icon and closed by tapping anywhere else.
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detailsId = useId();
  const detailsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!detailsOpen) return;
    const closeOnOutsidePress = (e: PointerEvent) => {
      if (!detailsRef.current?.contains(e.target as Node)) setDetailsOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePress);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePress);
  }, [detailsOpen]);

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
        <div ref={detailsRef} className="relative flex items-center gap-1.5">
          <p className="text-[16px] font-medium text-foreground">Auto-log to Diary</p>
          <button
            type="button"
            onClick={() => setDetailsOpen((open) => !open)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setDetailsOpen(false);
            }}
            aria-expanded={detailsOpen}
            aria-controls={detailsId}
            aria-label="About Auto-log to Diary"
            title={detailsOpen ? undefined : DETAILS}
            className={`-m-2 flex flex-shrink-0 cursor-help items-center justify-center rounded-full p-2 transition-colors hover:text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-control ${detailsOpen ? "text-foreground" : "text-dim"}`}
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="9" strokeWidth={2} />
              <path d="M12 16v-4.5M12 8h.01" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <p
            id={detailsId}
            role="status"
            hidden={!detailsOpen}
            className="absolute top-full left-0 z-20 mt-2 w-60 max-w-[calc(100vw-5rem)] rounded-lg border border-line-strong bg-background px-3 py-2 text-[12px] leading-relaxed text-foreground shadow-xl"
          >
            {DETAILS}
          </p>
        </div>
        <p className="mt-0.5 text-[14px] text-dim">Films watched in Stremio land in your public diary</p>
      </div>
      <Toggle enabled={control.kind === "toggle" && control.enabled} onToggle={onToggle} />
    </div>
  );
}
