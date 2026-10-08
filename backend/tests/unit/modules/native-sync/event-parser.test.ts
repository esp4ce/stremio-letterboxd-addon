import { describe, it, expect } from 'vitest';
import { parsePlayerExtra, parseLibraryExtra } from '../../../../src/modules/native-sync/event-parser.js';

describe('parsePlayerExtra', () => {
  it('parses a stop with times in milliseconds', () => {
    expect(parsePlayerExtra('action=stop&currentTime=8640000&duration=8880000')).toEqual({
      action: 'stop',
      currentTimeMs: 8640000,
      durationMs: 8880000,
    });
  });

  it('accepts start and pause', () => {
    expect(parsePlayerExtra('action=start&currentTime=0&duration=100')?.action).toBe('start');
    expect(parsePlayerExtra('action=pause&currentTime=50&duration=100')?.action).toBe('pause');
  });

  it.each([
    ['unknown action', 'action=seek&currentTime=1&duration=2'],
    ['missing action', 'currentTime=1&duration=2'],
    ['non-numeric time', 'action=stop&currentTime=abc&duration=2'],
    ['negative time', 'action=stop&currentTime=-1&duration=2'],
    ['decimal time', 'action=stop&currentTime=1.5&duration=2'],
    ['missing duration', 'action=stop&currentTime=1'],
    ['empty string', ''],
  ])('returns null for %s', (_label, extra) => {
    expect(parsePlayerExtra(extra)).toBeNull();
  });
});

describe('parseLibraryExtra', () => {
  it('parses a whole-item watched mark', () => {
    expect(parseLibraryExtra('action=watched')).toEqual({ action: 'watched', videoIds: [] });
  });

  it('splits videoId on commas', () => {
    expect(parseLibraryExtra('action=watched&videoId=a,b')).toEqual({ action: 'watched', videoIds: ['a', 'b'] });
  });

  it('accepts the four documented actions', () => {
    for (const action of ['libraryAdd', 'libraryRemove', 'watched', 'unwatched']) {
      expect(parseLibraryExtra(`action=${action}`)?.action).toBe(action);
    }
  });

  it('returns null for an unknown action', () => {
    expect(parseLibraryExtra('action=delete')).toBeNull();
  });
});
