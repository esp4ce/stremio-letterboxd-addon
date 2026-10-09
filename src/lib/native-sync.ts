import type { UserPreferences } from "../types/preferences";

export function withNativeSync(prefs: UserPreferences, enabled: boolean, timeZone: string | undefined): UserPreferences {
  if (!enabled) return { ...prefs, nativeSync: false };
  return { ...prefs, nativeSync: true, ...(timeZone ? { timezone: timeZone } : {}) };
}

export type NativeSyncControl = { kind: "toggle"; enabled: boolean; next: boolean } | { kind: "upsell" };

/** A member whose support lapsed while Native Sync was on can still switch it off, never back on. */
export function nativeSyncControl(prefs: UserPreferences, entitled: boolean): NativeSyncControl {
  const stored = prefs.nativeSync === true;
  if (entitled) return { kind: "toggle", enabled: stored, next: !stored };
  if (stored) return { kind: "toggle", enabled: true, next: false };
  return { kind: "upsell" };
}

export function browserTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}
