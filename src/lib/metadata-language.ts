import type { UserPreferences } from "../types/preferences";

/** Locales offered for film titles and synopses — mirrors the backend list. */
export const METADATA_LANGUAGES = [
  { code: "en-US", label: "English" },
  { code: "fr-FR", label: "Français" },
  { code: "es-ES", label: "Español (España)" },
  { code: "es-MX", label: "Español (Latinoamérica)" },
  { code: "pt-BR", label: "Português (Brasil)" },
  { code: "it-IT", label: "Italiano" },
  { code: "de-DE", label: "Deutsch" },
  { code: "nl-NL", label: "Nederlands" },
  { code: "tr-TR", label: "Türkçe" },
] as const;

export type MetadataLanguage = (typeof METADATA_LANGUAGES)[number]["code"];

export const DEFAULT_METADATA_LANGUAGE: MetadataLanguage = "en-US";

export type MetadataLanguageBlockReason = "supporter" | "signin";

export type MetadataLanguageControl =
  | { kind: "select"; value: string }
  | { kind: "blocked"; reason: MetadataLanguageBlockReason };

/**
 * Everyone sees the picker, but only a signed-in Supporter can use it. Anyone else
 * gets English from the backend, so the picker never shows an old stored choice.
 */
export function metadataLanguageControl(
  prefs: UserPreferences | null,
  access: { signedIn: boolean; entitled: boolean },
): MetadataLanguageControl {
  if (!access.signedIn || !prefs) return { kind: "blocked", reason: "signin" };
  if (!access.entitled) return { kind: "blocked", reason: "supporter" };
  return { kind: "select", value: prefs.metadataLanguage ?? DEFAULT_METADATA_LANGUAGE };
}

// Spanish outside Spain reads closer to Latin American titles than to Spain's.
const REGIONLESS_FALLBACK: Record<string, MetadataLanguage> = { es: "es-MX" };

/**
 * The offered locale matching a member's Stremio Account Locale, or null. Only a
 * suggestion for the picker: it never applies a language by itself.
 */
export function suggestMetadataLanguage(locale: string | undefined): MetadataLanguage | null {
  if (!locale) return null;
  const exact = METADATA_LANGUAGES.find((l) => l.code.toLowerCase() === locale.toLowerCase());
  const language = locale.split("-")[0]!.toLowerCase();
  const match = exact?.code ?? REGIONLESS_FALLBACK[language] ?? METADATA_LANGUAGES.find((l) => l.code.startsWith(`${language}-`))?.code;
  if (!match || match === DEFAULT_METADATA_LANGUAGE) return null;
  return match;
}

/** The first offered language among a member's locales, in their order of preference. */
export function suggestMetadataLanguageFrom(locales: readonly string[]): MetadataLanguage | null {
  for (const locale of locales) {
    const match = suggestMetadataLanguage(locale);
    if (match) return match;
  }
  return null;
}

export function withMetadataLanguage(prefs: UserPreferences, language: string): UserPreferences {
  return { ...prefs, metadataLanguage: language };
}

export function metadataLanguageBlockedMessage(reason: MetadataLanguageBlockReason): string {
  return reason === "signin"
    ? "Titles in your language need you to sign in with your Letterboxd password and a supporter subscription."
    : "Titles in your language need a supporter subscription.";
}

export function metadataLanguageLabel(code: string): string {
  return METADATA_LANGUAGES.find((l) => l.code === code)?.label ?? "English";
}
