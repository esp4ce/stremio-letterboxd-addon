import type { UserPreferences } from "../types/preferences";

export function withNativeSync(prefs: UserPreferences, enabled: boolean, timeZone: string | undefined): UserPreferences {
  if (!enabled) return { ...prefs, nativeSync: false };
  return { ...prefs, nativeSync: true, ...(timeZone ? { timezone: timeZone } : {}) };
}

export type NativeSyncBlockReason = "supporter" | "signin";

export type NativeSyncControl =
  | { kind: "toggle"; enabled: boolean; next: boolean }
  | { kind: "blocked"; reason: NativeSyncBlockReason };

/**
 * Everyone sees the toggle, but only a signed-in Supporter sees its real state and can
 * switch it. Anyone else sees it off: without supporter access nothing is ever logged,
 * whatever an old stored preference says.
 */
export function nativeSyncControl(
  prefs: UserPreferences | null,
  access: { signedIn: boolean; entitled: boolean },
): NativeSyncControl {
  if (!access.signedIn || !prefs) return { kind: "blocked", reason: "signin" };
  if (!access.entitled) return { kind: "blocked", reason: "supporter" };
  const stored = prefs.nativeSync === true;
  return { kind: "toggle", enabled: stored, next: !stored };
}

export function nativeSyncBlockedMessage(reason: NativeSyncBlockReason): string {
  return reason === "signin"
    ? "Auto-log to Diary needs you to sign in with your Letterboxd password and a supporter subscription."
    : "Auto-log to Diary needs a supporter subscription.";
}

export function browserTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}
