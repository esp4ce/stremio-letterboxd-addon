import { describe, it, expect } from 'vitest';
import { metadataLanguageControl, suggestMetadataLanguage, suggestMetadataLanguageFrom } from '../../src/lib/metadata-language';
import type { UserPreferences } from '../../src/types/preferences';

const prefs: UserPreferences = {
  catalogs: { watchlist: true, diary: false, friends: false, popular: false, top250: false, likedFilms: false, recommended: false },
  ownLists: [],
  externalLists: [],
};

describe('metadataLanguageControl', () => {
  it('lets a Supporter pick a language, English by default', () => {
    expect(metadataLanguageControl(prefs, { signedIn: true, entitled: true })).toEqual({ kind: 'select', value: 'en-US' });
    expect(metadataLanguageControl({ ...prefs, metadataLanguage: 'it-IT' }, { signedIn: true, entitled: true })).toEqual({
      kind: 'select',
      value: 'it-IT',
    });
  });

  it('blocks a member who is not a Supporter, whatever they saved before', () => {
    expect(metadataLanguageControl({ ...prefs, metadataLanguage: 'fr-FR' }, { signedIn: true, entitled: false })).toEqual({
      kind: 'blocked',
      reason: 'supporter',
    });
  });

  it('asks a visitor in public mode to sign in', () => {
    expect(metadataLanguageControl(null, { signedIn: false, entitled: false })).toEqual({ kind: 'blocked', reason: 'signin' });
  });
});

describe('suggestMetadataLanguage', () => {
  it('suggests the exact locale when it is offered', () => {
    expect(suggestMetadataLanguage('fr-FR')).toBe('fr-FR');
    expect(suggestMetadataLanguage('es-ES')).toBe('es-ES');
  });

  it('suggests the offered locale of the same language for another region', () => {
    expect(suggestMetadataLanguage('fr-CA')).toBe('fr-FR');
    expect(suggestMetadataLanguage('pt-PT')).toBe('pt-BR');
    expect(suggestMetadataLanguage('de')).toBe('de-DE');
  });

  it('suggests Latin American Spanish for any Spanish outside Spain', () => {
    expect(suggestMetadataLanguage('es-AR')).toBe('es-MX');
    expect(suggestMetadataLanguage('es')).toBe('es-MX');
  });

  it('suggests nothing for English, an unoffered language or no locale', () => {
    expect(suggestMetadataLanguage('en-GB')).toBeNull();
    expect(suggestMetadataLanguage('ja-JP')).toBeNull();
    expect(suggestMetadataLanguage(undefined)).toBeNull();
    expect(suggestMetadataLanguage('')).toBeNull();
  });
});

describe('suggestMetadataLanguageFrom', () => {
  it('takes the first offered language among several locales, skipping English', () => {
    expect(suggestMetadataLanguageFrom(['en-US', 'fr-FR', 'fr', 'en'])).toBe('fr-FR');
    expect(suggestMetadataLanguageFrom(['ja-JP', 'pt-PT'])).toBe('pt-BR');
  });

  it('suggests nothing when no locale is offered', () => {
    expect(suggestMetadataLanguageFrom(['en-GB', 'en'])).toBeNull();
    expect(suggestMetadataLanguageFrom([])).toBeNull();
  });
});
