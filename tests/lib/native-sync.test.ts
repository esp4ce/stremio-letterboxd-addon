import { describe, it, expect } from 'vitest';
import { nativeSyncBlockedMessage, nativeSyncControl, withNativeSync } from '../../src/lib/native-sync';
import type { UserPreferences } from '../../src/types/preferences';

const prefs: UserPreferences = {
  catalogs: { watchlist: true, diary: false, friends: false, popular: false, top250: false, likedFilms: false, recommended: false },
  ownLists: [],
  externalLists: [],
};

describe('withNativeSync', () => {
  it('captures the browser timezone when turned on', () => {
    expect(withNativeSync(prefs, true, 'Europe/Paris')).toMatchObject({ nativeSync: true, timezone: 'Europe/Paris' });
  });

  it('keeps the stored timezone when turned off', () => {
    const on = withNativeSync(prefs, true, 'Europe/Paris');
    expect(withNativeSync(on, false, 'America/New_York')).toMatchObject({ nativeSync: false, timezone: 'Europe/Paris' });
  });

  it('turns on without a timezone when the browser gives none', () => {
    const result = withNativeSync(prefs, true, undefined);
    expect(result.nativeSync).toBe(true);
    expect(result.timezone).toBeUndefined();
  });
});

describe('nativeSyncControl', () => {
  it('lets a supporter switch it on and off', () => {
    expect(nativeSyncControl(prefs, { signedIn: true, entitled: true })).toEqual({ kind: 'toggle', enabled: false, next: true });
    expect(nativeSyncControl({ ...prefs, nativeSync: true }, { signedIn: true, entitled: true })).toEqual({ kind: 'toggle', enabled: true, next: false });
  });

  it('lets a lapsed member who left it on only switch it off', () => {
    expect(nativeSyncControl({ ...prefs, nativeSync: true }, { signedIn: true, entitled: false })).toEqual({ kind: 'toggle', enabled: true, next: false });
  });

  it('shows a signed-in member who is not a supporter an off toggle that is blocked', () => {
    expect(nativeSyncControl(prefs, { signedIn: true, entitled: false })).toEqual({ kind: 'blocked', reason: 'supporter' });
    expect(nativeSyncControl({ ...prefs, nativeSync: false }, { signedIn: true, entitled: false })).toEqual({ kind: 'blocked', reason: 'supporter' });
  });

  it('blocks it in public mode, where there is no account to write with', () => {
    expect(nativeSyncControl(null, { signedIn: false, entitled: false })).toEqual({ kind: 'blocked', reason: 'signin' });
  });
});

describe('nativeSyncBlockedMessage', () => {
  it('explains what is missing', () => {
    expect(nativeSyncBlockedMessage('supporter')).toBe('Auto-log to Diary needs a supporter subscription.');
    expect(nativeSyncBlockedMessage('signin')).toBe('Auto-log to Diary needs you to sign in with your Letterboxd password and a supporter subscription.');
  });
});
