import { describe, it, expect } from 'vitest';
import {
  COMPLETION_THRESHOLD,
  isValidTimeZone,
  localDateIn,
  draftFromPlayerEvent,
  draftFromLibraryEvent,
} from '../../../../src/modules/native-sync/job-rules.js';

const NOW = new Date('2026-10-08T12:00:00.000Z');

describe('localDateIn', () => {
  it('uses the member timezone, not UTC — Los Angeles evening', () => {
    // 20:00 in Los Angeles (UTC-7 in October) is 03:00 UTC the next day
    expect(localDateIn(new Date('2026-10-09T03:00:00Z'), 'America/Los_Angeles')).toBe('2026-10-08');
  });

  it('uses the member timezone, not UTC — Paris just after midnight', () => {
    // 00:30 in Paris (UTC+2 in October) is 22:30 UTC the previous day
    expect(localDateIn(new Date('2026-10-08T22:30:00Z'), 'Europe/Paris')).toBe('2026-10-09');
  });

  it('falls back to UTC when the timezone is missing or invalid', () => {
    const late = new Date('2026-10-08T23:30:00Z');
    expect(localDateIn(late)).toBe('2026-10-08');
    expect(localDateIn(late, 'Not/AZone')).toBe('2026-10-08');
  });
});

describe('isValidTimeZone', () => {
  it('accepts IANA names and rejects junk', () => {
    expect(isValidTimeZone('Europe/Paris')).toBe(true);
    expect(isValidTimeZone('Not/AZone')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
  });
});

describe('draftFromPlayerEvent', () => {
  const at = (ratio: number, action: 'start' | 'pause' | 'stop' = 'stop') => ({
    action,
    currentTimeMs: Math.round(ratio * 1000),
    durationMs: 1000,
  });

  it('creates a diary draft at exactly the threshold', () => {
    expect(draftFromPlayerEvent(at(COMPLETION_THRESHOLD), NOW, 'Europe/Paris')).toEqual({
      kind: 'diary',
      localDate: '2026-10-08',
      occurredAt: NOW.toISOString(),
    });
  });

  it('ignores a stop just under the threshold', () => {
    expect(draftFromPlayerEvent({ action: 'stop', currentTimeMs: 799, durationMs: 1000 }, NOW)).toBeNull();
  });

  it('accepts pause past the threshold (app killed before stop)', () => {
    expect(draftFromPlayerEvent(at(0.95, 'pause'), NOW)?.kind).toBe('diary');
  });

  it('never acts on start', () => {
    expect(draftFromPlayerEvent(at(0.99, 'start'), NOW)).toBeNull();
  });

  it('ignores a zero duration', () => {
    expect(draftFromPlayerEvent({ action: 'stop', currentTimeMs: 0, durationMs: 0 }, NOW)).toBeNull();
  });
});

describe('draftFromLibraryEvent', () => {
  it('maps a whole-item watched mark to a watch flag', () => {
    expect(draftFromLibraryEvent({ action: 'watched', videoIds: [] }, NOW)).toEqual({
      kind: 'watch_flag',
      localDate: '2026-10-08',
      occurredAt: NOW.toISOString(),
    });
  });

  it('ignores marks on specific videos', () => {
    expect(draftFromLibraryEvent({ action: 'watched', videoIds: ['tt1:1:1'] }, NOW)).toBeNull();
  });

  it.each(['unwatched', 'libraryAdd', 'libraryRemove'] as const)('never acts on %s', (action) => {
    expect(draftFromLibraryEvent({ action, videoIds: [] }, NOW)).toBeNull();
  });
});
