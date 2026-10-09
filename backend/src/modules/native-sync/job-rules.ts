import type { LibraryEvent, PlayerEvent } from './event-parser.js';

export const COMPLETION_THRESHOLD = 0.8;

export type JobKind = 'diary' | 'watch_flag';

export interface JobDraft {
  kind: JobKind;
  /** Member-local calendar day, YYYY-MM-DD */
  localDate: string;
  /** UTC ISO timestamp of reception */
  occurredAt: string;
}

export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** en-CA formats as YYYY-MM-DD */
export function localDateIn(now: Date, timeZone?: string): string {
  const zone = timeZone && isValidTimeZone(timeZone) ? timeZone : 'UTC';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function draft(kind: JobKind, now: Date, timeZone?: string): JobDraft {
  return { kind, localDate: localDateIn(now, timeZone), occurredAt: now.toISOString() };
}

export function draftFromPlayerEvent(event: PlayerEvent, now: Date, timeZone?: string): JobDraft | null {
  if (event.action === 'start') return null;
  if (event.durationMs <= 0) return null;
  if (event.currentTimeMs / event.durationMs < COMPLETION_THRESHOLD) return null;
  return draft('diary', now, timeZone);
}

export function draftFromLibraryEvent(event: LibraryEvent, now: Date, timeZone?: string): JobDraft | null {
  if (event.action !== 'watched' || event.videoIds.length > 0) return null;
  return draft('watch_flag', now, timeZone);
}
