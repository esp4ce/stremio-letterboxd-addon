// Languages offered for film titles and synopses.
export const METADATA_LANGUAGES = ['en-US', 'fr-FR', 'es-ES', 'es-MX', 'pt-BR', 'it-IT', 'de-DE', 'nl-NL', 'tr-TR'] as const;

export type MetadataLanguage = (typeof METADATA_LANGUAGES)[number];

export const DEFAULT_METADATA_LANGUAGE: MetadataLanguage = 'en-US';
