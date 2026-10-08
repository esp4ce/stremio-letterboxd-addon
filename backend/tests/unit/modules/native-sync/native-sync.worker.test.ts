import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { initDb, closeDb, getDb } from '../../../../src/db/index.js';
import { createUser, updateUserPreferences } from '../../../../src/db/repositories/user.repository.js';
import { enqueueJob } from '../../../../src/db/repositories/native-sync-job.repository.js';
import { LetterboxdApiError } from '../../../../src/modules/letterboxd/letterboxd.client.js';

const client = {
  getFilmRelationship: vi.fn(),
  updateFilmRelationship: vi.fn(),
  createDiaryEntry: vi.fn(),
  getMemberLogEntries: vi.fn(),
};
const createClientForUser = vi.fn();
const resolveFilmForWrite = vi.fn();
const getEntitlementStatus = vi.fn();

vi.mock('../../../../src/modules/stremio/user-client.service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/modules/stremio/user-client.service.js')>();
  return { ...actual, createClientForUser: (...a: unknown[]) => createClientForUser(...a) };
});
vi.mock('../../../../src/modules/native-sync/film-resolver.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/modules/native-sync/film-resolver.js')>();
  return { ...actual, resolveFilmForWrite: (...a: unknown[]) => resolveFilmForWrite(...a) };
});
vi.mock('../../../../src/modules/billing/billing.service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/modules/billing/billing.service.js')>();
  return { ...actual, getEntitlementStatus: (...a: unknown[]) => getEntitlementStatus(...a) };
});

const { processNextJob, startNativeSyncWorker } = await import('../../../../src/modules/native-sync/native-sync.worker.js');
const { SessionExpiredError } = await import('../../../../src/modules/stremio/user-client.service.js');
const { ResolverUnavailableError } = await import('../../../../src/modules/native-sync/film-resolver.js');

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
    resolveFilmForWrite.mockResolvedValue({ letterboxdFilmId: 'lbFilm' });
    client.getMemberLogEntries.mockResolvedValue({ items: [] });
    client.getFilmRelationship.mockResolvedValue({ watched: false, liked: false, inWatchlist: false });
    client.createDiaryEntry.mockResolvedValue(undefined);
    client.updateFilmRelationship.mockResolvedValue({ data: {}, messages: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
    closeDb();
  });

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
    expect(row()).toMatchObject({ status: 'pending', last_error: 'entitlement_unavailable', next_attempt_at: '2026-10-08T12:30:00.000Z' });
  });

  it('fails without retry when the session expired', async () => {
    createClientForUser.mockRejectedValue(new SessionExpiredError(userId));
    enqueue('diary');
    await processNextJob(NOW);
    expect(row()).toMatchObject({ status: 'failed', last_error: 'token_revoked' });
  });

  it('fails without retry when the film cannot be found', async () => {
    resolveFilmForWrite.mockResolvedValue(null);
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
  it('proceeds to write when entitlement is true but untrusted', async () => {
    getEntitlementStatus.mockResolvedValue({ entitled: true, trustworthy: false });
    enqueue('diary');
    await processNextJob(NOW);
    expect(client.createDiaryEntry).toHaveBeenCalled();
    expect(row()?.status).toBe('done');
  });

  it.each([
    [401, 'failed', 'token_revoked'],
    [403, 'failed', 'forbidden'],
    [404, 'failed', 'film_not_found'],
    [429, 'pending', 'upstream_error'],
  ])('classifies a %i from upstream', async (status, expectedStatus, reason) => {
    client.createDiaryEntry.mockRejectedValue(new LetterboxdApiError(status, 'x'));
    enqueue('diary');
    await processNextJob(NOW);
    expect(row()).toMatchObject({ status: expectedStatus, last_error: reason });
  });

  it('retries when the resolver is unavailable', async () => {
    resolveFilmForWrite.mockRejectedValue(new ResolverUnavailableError());
    enqueue('diary');
    await processNextJob(NOW);
    expect(row()).toMatchObject({ status: 'pending', last_error: 'resolver_unavailable' });
  });

  it('skips a watch flag that is already set', async () => {
    client.getFilmRelationship.mockResolvedValue({ watched: true, liked: false, inWatchlist: false });
    enqueue('watch_flag');
    await processNextJob(NOW);
    expect(client.updateFilmRelationship).not.toHaveBeenCalled();
    expect(row()?.status).toBe('done');
  });

  it('writes the watch flag when the same-day diary job failed', async () => {
    enqueue('diary');
    getDb().prepare("UPDATE native_sync_jobs SET status = 'failed'").run();
    enqueue('watch_flag');
    await processNextJob(NOW);
    expect(client.updateFilmRelationship).toHaveBeenCalledWith('lbFilm', { watched: true });
  });

  it('skips a covered watch flag before building a client or resolving the film', async () => {
    enqueue('diary');
    enqueue('watch_flag');
    getDb().prepare("UPDATE native_sync_jobs SET status = 'done' WHERE kind = 'diary'").run();
    await processNextJob(NOW);
    expect(createClientForUser).not.toHaveBeenCalled();
    expect(resolveFilmForWrite).not.toHaveBeenCalled();
    expect(row()).toBeDefined();
  });

  describe('idempotent diary writes', () => {
    const retryAttempt = () => {
      enqueue('diary');
      getDb().prepare('UPDATE native_sync_jobs SET attempts = 1').run(); // claim makes this attempt 2
    };

    it('reads the log on a first attempt', async () => {
      enqueue('diary');
      await processNextJob(NOW);
      expect(client.getMemberLogEntries).toHaveBeenCalledWith({ perPage: 20 });
      expect(client.createDiaryEntry).toHaveBeenCalled();
    });

    it('does not write on a first attempt when the member already logged the film that day', async () => {
      enqueue('diary');
      client.getMemberLogEntries.mockResolvedValue({
        items: [{ id: 'hand', diaryDate: '2026-10-08', film: { id: 'lbFilm' } }],
      });
      await processNextJob(NOW);
      expect(client.createDiaryEntry).not.toHaveBeenCalled();
      expect(row()?.status).toBe('done');
    });

    it('skips the write on a retry when the entry already exists', async () => {
      retryAttempt();
      client.getMemberLogEntries.mockResolvedValue({
        items: [{ id: 'e1', diaryDate: '2026-10-08', film: { id: 'lbFilm' } }],
      });
      await processNextJob(NOW);
      expect(client.getMemberLogEntries).toHaveBeenCalledWith({ perPage: 20 });
      expect(client.createDiaryEntry).not.toHaveBeenCalled();
      expect(row()?.status).toBe('done');
    });

    it('writes on a retry when no entry matches film and day', async () => {
      retryAttempt();
      client.getMemberLogEntries.mockResolvedValue({
        items: [
          { id: 'e1', diaryDate: '2026-10-07', film: { id: 'lbFilm' } },
          { id: 'e2', diaryDate: '2026-10-08', film: { id: 'other' } },
        ],
      });
      await processNextJob(NOW);
      expect(client.createDiaryEntry).toHaveBeenCalled();
    });
  });

  describe('entitlement outage', () => {
    it('keeps retrying every 30 minutes beyond the normal budget', async () => {
      getEntitlementStatus.mockResolvedValue({ entitled: false, trustworthy: false });
      enqueue('diary');
      getDb().prepare('UPDATE native_sync_jobs SET attempts = 9').run();
      await processNextJob(NOW);
      expect(row()).toMatchObject({
        status: 'pending',
        last_error: 'entitlement_unavailable',
        next_attempt_at: '2026-10-08T12:30:00.000Z',
      });
    });

    it('fails once the watch is more than 24 hours old', async () => {
      getEntitlementStatus.mockResolvedValue({ entitled: false, trustworthy: false });
      enqueueJob({
        userId,
        imdbId: 'tt0816692',
        kind: 'diary',
        localDate: '2026-10-07',
        occurredAt: '2026-10-07T11:00:00.000Z',
      });
      await processNextJob(NOW);
      expect(row()).toMatchObject({ status: 'failed', last_error: 'entitlement_unavailable' });
    });
  });

  describe('lifecycle', () => {
    it('stop waits for an in-flight job', async () => {
      vi.useFakeTimers({ now: NOW });
      let release: (v: { entitled: boolean; trustworthy: boolean }) => void = () => {};
      getEntitlementStatus.mockReturnValue(new Promise((r) => (release = r)));
      enqueue('diary');
      const stop = startNativeSyncWorker();
      vi.advanceTimersByTime(2000);

      let stopped = false;
      const stopping = stop().then(() => {
        stopped = true;
      });
      await Promise.resolve();
      expect(stopped).toBe(false);

      release({ entitled: true, trustworthy: true });
      await stopping;
      expect(stopped).toBe(true);
      expect(row()?.status).toBe('done');
    });

    it('purges expired rows at startup', async () => {
      vi.useFakeTimers({ now: NOW });
      enqueueJob({ userId, imdbId: 'ttOld', kind: 'diary', localDate: '2026-09-01', occurredAt: '2026-09-01T00:00:00.000Z' });
      getDb().prepare("UPDATE native_sync_jobs SET status = 'failed'").run();
      await startNativeSyncWorker()();
      expect(row()).toBeUndefined();
    });
  });

  it('does not spend the retry budget while billing is unreachable', async () => {
    getEntitlementStatus.mockResolvedValue({ entitled: false, trustworthy: false });
    enqueue('diary');
    const makeDue = () => getDb().prepare('UPDATE native_sync_jobs SET next_attempt_at = ?').run(NOW.toISOString());
    for (let i = 0; i < 5; i++) {
      await processNextJob(NOW);
      makeDue();
    }
    getEntitlementStatus.mockResolvedValue({ entitled: true, trustworthy: true });
    client.createDiaryEntry.mockRejectedValue(new LetterboxdApiError(503, 'Service Unavailable'));
    await processNextJob(NOW);
    expect(row()).toMatchObject({ status: 'pending', last_error: 'upstream_error', next_attempt_at: '2026-10-08T12:01:00.000Z' });
  });

  it('stop gives up on a job that never settles', async () => {
    vi.useFakeTimers({ now: NOW });
    getEntitlementStatus.mockReturnValue(new Promise(() => {}));
    enqueue('diary');
    const stop = startNativeSyncWorker();
    vi.advanceTimersByTime(2000);
    const stopping = stop();
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(stopping).resolves.toBeUndefined();
  });
});
