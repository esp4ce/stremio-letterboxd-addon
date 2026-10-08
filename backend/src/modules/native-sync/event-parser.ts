export type PlayerAction = 'start' | 'pause' | 'stop';
export type LibraryAction = 'libraryAdd' | 'libraryRemove' | 'watched' | 'unwatched';

export interface PlayerEvent {
  action: PlayerAction;
  currentTimeMs: number;
  durationMs: number;
}

export interface LibraryEvent {
  action: LibraryAction;
  videoIds: string[];
}

const PLAYER_ACTIONS: ReadonlySet<string> = new Set(['start', 'pause', 'stop']);
const LIBRARY_ACTIONS: ReadonlySet<string> = new Set(['libraryAdd', 'libraryRemove', 'watched', 'unwatched']);
const NON_NEGATIVE_INT = /^\d{1,15}$/;

function parseMs(value: string | null): number | null {
  if (value === null || !NON_NEGATIVE_INT.test(value)) return null;
  return Number(value);
}

export function parsePlayerExtra(extra: string): PlayerEvent | null {
  const params = new URLSearchParams(extra);
  const action = params.get('action');
  if (action === null || !PLAYER_ACTIONS.has(action)) return null;

  const currentTimeMs = parseMs(params.get('currentTime'));
  const durationMs = parseMs(params.get('duration'));
  if (currentTimeMs === null || durationMs === null) return null;

  return { action: action as PlayerAction, currentTimeMs, durationMs };
}

export function parseLibraryExtra(extra: string): LibraryEvent | null {
  const params = new URLSearchParams(extra);
  const action = params.get('action');
  if (action === null || !LIBRARY_ACTIONS.has(action)) return null;

  const videoId = params.get('videoId');
  const videoIds = videoId ? videoId.split(',').filter(Boolean) : [];
  return { action: action as LibraryAction, videoIds };
}
