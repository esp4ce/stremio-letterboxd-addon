import type { UserPreferences } from "../types/preferences";

export function withNativeSync(prefs: UserPreferences, enabled: boolean, timeZone: string | undefined): UserPreferences {
  if (!enabled) return { ...prefs, nativeSync: false };
  return { ...prefs, nativeSync: true, ...(timeZone ? { timezone: timeZone } : {}) };
}

export function browserTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}
