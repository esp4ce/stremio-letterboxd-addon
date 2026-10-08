import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { initDb, closeDb, getDb } from '../../../../src/db/index.js';
import { createUser, updateUserPreferences } from '../../../../src/db/repositories/user.repository.js';
import { enqueueJob } from '../../../../src/db/repositories/native-sync-job.repository.js';
import { LetterboxdApiError } from '../../../../src/modules/letterboxd/letterboxd.client.js';

const client = {
  getFilmRelationship: vi.fn(),
  updateFilmRelationship: vi.fn(),
  createDiaryEntry: vi.fn(),
};
const createClientForUser = vi.fn();
const findFilmByImdb = vi.fn();
const getEntitlementStatus = vi.fn();

vi.mock('../../../../src/modules/stremio/user-client.service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/modules/stremio/user-client.service.js')>();
  return { ...actual, createClientForUser: (...a: unknown[]) => createClientForUser(...a) };
});
vi.mock('../../../../src/modules/stremio/meta.service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/modules/stremio/meta.service.js')>();
  return { ...actual, findFilmByImdb: (...a: unknown[]) => findFilmByImdb(...a) };
});
vi.mock('../../../../src/modules/billing/billing.service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/modules/billing/billing.service.js')>();
  return { ...actual, getEntitlementStatus: (...a: unknown[]) => getEntitlementStatus(...a) };
});

const { processNextJob } = await import('../../../../src/modules/native-sync/native-sync.worker.js');
const { SessionExpiredError } = await import('../../../../src/modules/stremio/user-client.service.js');

const NOW = new Date('2026-10-08T12:00:00.000Z');
const base = {
  catalogs: { watchlist: true, diary: false, friends: false, popular: false, top250: false, likedFilms: false, recommended: false },
  ownLists: [],
  externalLists: [],
};

function row(): { status: string; attempts: number; last_error: string | null; next_attempt_at: string } | undefined {
  return getDb().prepare('SELECT status, attempts, last_error, next_attempt_at FROM native_sync_jobs').get() as never;
}

describe('native sync worker', () => {
  let userId: string;

  beforeEach(() => {
    initDb();
    vi.clearAllMocks();
    userId = createUser({ letterboxdId: 'lb-w', letterboxdUsername: 'w', refreshToken: 'fake' }).id;
    updateUserPreferences(userId, { ...base, nativeSync: true });
    getEntitlementStatus.mockResolvedValue({ entitled: true, trustworthy: true });
    createClientForUser.mockResolvedValue(client);
    findFilmByImdb.mockResolvedValue({ letterboxdFilmId: 'lbFilm', film: {} });
    client.getFilmRelationship.mockResolvedValue({ watched: false, liked: false, inWatchlist: false });
    client.createDiaryEntry.mockResolvedValue(undefined);
    client.updateFilmRelationship.mockResolvedValue({ data: {}, messages: [] });
  });

  afterEach(() => closeDb());

  const enqueue = (kind: 'diary' | 'watch_flag') =>
    enqueueJob({ userId, imdbId: 'tt0816692', kind, localDate: '2026-10-08', occurredAt: NOW.toISOString() });

  it('is idle with an empty queue', async () => {
    expect(await processNextJob(NOW)).toBe('idle');
  });

  it('writes a first viewing as a plain diary entry dated on the local day', async () => {
    enqueue('diary');
    expect(await processNextJob(NOW)).toBe('processed');
    expect(client.createDiaryEntry).toHaveBeenCalledWith({ filmId: 'lbFilm', diaryDate: '2026-10-08', rewatch: false });
    expect(row()?.status).toBe('done');
  });

  it('marks a rewatch when the film was already marked watched', async () => {
    client.getFilmRelationship.mockResolvedValue({ watched: true, liked: false, inWatchlist: false });
    enqueue('diary');
    await processNextJob(NOW);
    expect(client.createDiaryEntry).toHaveBeenCalledWith({ filmId: 'lbFilm', diaryDate: '2026-10-08', rewatch: true });
  });

  it('sets the watch flag for a library mark', async () => {
    enqueue('watch_flag');
    await processNextJob(NOW);
    expect(client.updateFilmRelationship).toHaveBeenCalledWith('lbFilm', { watched: true });
    expect(client.createDiaryEntry).not.toHaveBeenCalled();
    expect(row()?.status).toBe('done');
  });

  it('skips the watch flag when a diary job exists for the same day', async () => {
    enqueue('diary');
    await processNextJob(NOW);
    enqueue('watch_flag');
    await processNextJob(NOW);
    expect(client.updateFilmRelationship).not.toHaveBeenCalled();
  });

  it('drops the job when the member is no longer a supporter', async () => {
    getEntitlementStatus.mockResolvedValue({ entitled: false, trustworthy: true });
    enqueue('diary');
    await processNextJob(NOW);
    expect(client.createDiaryEntry).not.toHaveBeenCalled();
    expect(row()).toBeUndefined();
  });

  it('drops the job when the member turned native sync off', async () => {
    updateUserPreferences(userId, { ...base, nativeSync: false });
    enqueue('diary');
    await processNextJob(NOW);
    expect(createClientForUser).not.toHaveBeenCalled();
    expect(row()).toBeUndefined();
  });

  it('retries instead of dropping when Polar is unreachable', async () => {
    getEntitlementStatus.mockResolvedValue({ entitled: false, trustworthy: false });
    enqueue('diary');
    await processNextJob(NOW);
    expect(row()).toMatchObject({ status: 'pending', last_error: 'entitlement_unavailable', next_attempt_at: '2026-10-08T12:01:00.000Z' });
  });

  it('fails without retry when the session expired', async () => {
    createClientForUser.mockRejectedValue(new SessionExpiredError(userId));
    enqueue('diary');
    await processNextJob(NOW);
    expect(row()).toMatchObject({ status: 'failed', last_error: 'token_revoked' });
  });

  it('fails without retry when the film cannot be found', async () => {
    findFilmByImdb.mockResolvedValue(null);
    enqueue('diary');
    await processNextJob(NOW);
    expect(row()).toMatchObject({ status: 'failed', last_error: 'film_not_found' });
  });

  it('backs off 1, 5, 30 minutes on upstream errors, then fails', async () => {
    client.createDiaryEntry.mockRejectedValue(new LetterboxdApiError(503, 'Service Unavailable'));
    enqueue('diary');
    // Delays count from processing time; each retry is made due again by hand.
    const makeDue = () => getDb().prepare('UPDATE native_sync_jobs SET next_attempt_at = ?').run(NOW.toISOString());

    await processNextJob(NOW);
    expect(row()).toMatchObject({ status: 'pending', last_error: 'upstream_error', next_attempt_at: '2026-10-08T12:01:00.000Z' });
    makeDue();
    await processNextJob(NOW);
    expect(row()?.next_attempt_at).toBe('2026-10-08T12:05:00.000Z');
    makeDue();
    await processNextJob(NOW);
    expect(row()?.next_attempt_at).toBe('2026-10-08T12:30:00.000Z');
    makeDue();
    await processNextJob(NOW);
    expect(row()).toMatchObject({ status: 'failed', attempts: 4, last_error: 'upstream_error' });
  });
});
