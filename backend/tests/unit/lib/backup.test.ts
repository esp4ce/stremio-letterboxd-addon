import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Lets a test pretend the live database is huge without writing gigabytes to disk.
const fakeSizes = vi.hoisted(() => new Map<string, number>());
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    statSync: ((path: string, ...rest: unknown[]) => {
      const st = (actual.statSync as (...a: unknown[]) => import('node:fs').Stats)(path, ...rest);
      const size = typeof path === 'string' ? fakeSizes.get(path) : undefined;
      return size === undefined ? st : new Proxy(st, { get: (t, k) => (k === 'size' ? size : Reflect.get(t, k)) });
    }) as typeof actual.statSync,
  };
});
import { envSchema } from '../../../src/config/env.schema.js';
import Database from 'better-sqlite3';
import { mkdtempSync, mkdirSync, rmSync, readdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  takeSnapshot,
  rotateBackups,
  uploadToS3,
  runBackup,
  startBackupScheduler,
  backupOptionsFromEnv,
  cleanupOrphans,
  deriveSigningKey,
  requiredFreeBytes,
  signV4,
  type BackupOptions,
  type S3Target,
} from '../../../src/lib/backup.js';

const S3: S3Target = {
  endpoint: 'https://s3.example.test',
  bucket: 'my-bucket',
  region: 'auto',
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'super-secret-value',
  prefix: 'stremboxd/',
};

let dir: string;
let db: Database.Database;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'backup-test-'));
  db = new Database(join(dir, 'live.db'));
  db.pragma('journal_mode = WAL');
  db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
  db.prepare('INSERT INTO t (v) VALUES (?)').run('hello');
});

afterEach(() => {
  fakeSizes.clear();
  vi.useRealTimers();
  if (db.open) db.close();
  rmSync(dir, { recursive: true, force: true });
});

function opts(over: Partial<BackupOptions> = {}): BackupOptions {
  return {
    enabled: true,
    dir: join(dir, 'backups'),
    intervalMs: 1000,
    initialDelayMs: 100,
    keep: 3,
    s3: null,
    ...over,
  };
}

describe('takeSnapshot', () => {
  it('creates a consistent, readable copy including WAL-only writes', async () => {
    const backups = join(dir, 'backups');
    const path = await takeSnapshot(db, backups, new Date('2026-01-02T03:04:05Z'));

    expect(path).toBe(join(backups, 'stremio-letterboxd-20260102T030405Z.db.gz'));
    const raw = join(dir, 'restored.db');
    writeFileSync(raw, gunzipSync(readFileSync(path)));
    const copy = new Database(raw, { readonly: true });
    expect(copy.prepare('SELECT v FROM t').all()).toEqual([{ v: 'hello' }]);
    copy.close();
    expect(readdirSync(backups)).toEqual(['stremio-letterboxd-20260102T030405Z.db.gz']);
  });

  it('removes the raw tmp copy once compressed (no .tmp left)', async () => {
    const backups = join(dir, 'backups');
    await takeSnapshot(db, backups, new Date('2026-01-02T03:04:05Z'));
    expect(readdirSync(backups).some((f) => f.includes('.tmp'))).toBe(false);
  });

  it('cleans up the raw tmp copy when compression fails', async () => {
    const backups = join(dir, 'backups');
    mkdirSync(backups, { recursive: true });
    const now = new Date('2026-01-02T03:04:05Z');
    // A directory squatting on the gz tmp name makes the write stream fail.
    mkdirSync(join(backups, 'stremio-letterboxd-20260102T030405Z.db.gz.tmp'));
    await expect(takeSnapshot(db, backups, now)).rejects.toThrow();
    expect(readdirSync(backups).filter((f) => f.endsWith('.db.tmp'))).toEqual([]);
  });

  it('rejects and removes the file when integrity check fails', async () => {
    const backups = join(dir, 'backups');
    await expect(
      takeSnapshot(db, backups, new Date(), () => 'row 1 missing from index'),
    ).rejects.toThrow(/integrity/i);
    expect(readdirSync(backups)).toEqual([]);
  });

  it('does not leak check output into the error message', async () => {
    await expect(
      takeSnapshot(db, join(dir, 'backups'), new Date(), () => 'secret row content'),
    ).rejects.not.toThrow(/secret row content/);
  });
});

describe('rotateBackups', () => {
  it('keeps only the N newest snapshots and ignores other files', () => {
    const backups = join(dir, 'backups');
    mkdirSync(backups, { recursive: true });
    for (const d of ['01', '02', '03', '04']) {
      writeFileSync(join(backups, `stremio-letterboxd-202601${d}T000000Z.db`), 'x');
    }
    writeFileSync(join(backups, 'notes.txt'), 'keep me');

    const removed = rotateBackups(backups, 2);

    expect(removed).toHaveLength(2);
    expect(readdirSync(backups).sort()).toEqual([
      'notes.txt',
      'stremio-letterboxd-20260103T000000Z.db',
      'stremio-letterboxd-20260104T000000Z.db',
    ]);
  });

  it('never deletes when keep is below 1 or dir is missing', () => {
    expect(rotateBackups(join(dir, 'nope'), 0)).toEqual([]);
    expect(rotateBackups(join(dir, 'nope'), 3)).toEqual([]);
  });
});

describe('uploadToS3', () => {
  it('sends a signed PUT without leaking the secret', async () => {
    const file = join(dir, 'snap.db');
    writeFileSync(file, 'payload');
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });

    await uploadToS3(
      file,
      'snap.db',
      S3,
      fetchMock as unknown as typeof fetch,
      new Date('2026-01-02T03:04:05Z'),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://s3.example.test/my-bucket/stremboxd/snap.db');
    expect(init.method).toBe('PUT');
    expect(init.headers['authorization']).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/20260102\/auto\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/,
    );
    expect(init.headers['x-amz-date']).toBe('20260102T030405Z');
    expect(JSON.stringify(init.headers)).not.toContain('super-secret-value');
  });

  it('streams the body with UNSIGNED-PAYLOAD and a known Content-Length', async () => {
    const file = join(dir, 'snap.db.gz');
    writeFileSync(file, 'payload-123');
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const chunks: Buffer[] = [];
      for await (const c of init.body as unknown as AsyncIterable<Buffer>) chunks.push(Buffer.from(c));
      expect(Buffer.concat(chunks).toString()).toBe('payload-123');
      return { ok: true, status: 200 };
    });

    await uploadToS3(file, 'snap.db.gz', S3, fetchMock as unknown as typeof fetch);

    const init = fetchMock.mock.calls[0]![1] as RequestInit & { duplex?: string };
    const headers = init.headers as Record<string, string>;
    expect(Buffer.isBuffer(init.body)).toBe(false);
    expect(typeof (init.body as ReadableStream).getReader).toBe('function');
    expect(init.duplex).toBe('half');
    expect(headers['x-amz-content-sha256']).toBe('UNSIGNED-PAYLOAD');
    expect(headers['content-length']).toBe('11');
  });

  it('refuses a non-https endpoint', async () => {
    const file = join(dir, 'snap.db.gz');
    writeFileSync(file, 'payload');
    const fetchMock = vi.fn();
    await expect(
      uploadToS3(file, 'snap.db.gz', { ...S3, endpoint: 'http://s3.example.test' }, fetchMock as unknown as typeof fetch),
    ).rejects.toThrow(/https/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws with status only on non-2xx', async () => {
    const file = join(dir, 'snap.db');
    writeFileSync(file, 'payload');
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 403 });
    await expect(
      uploadToS3(file, 'snap.db', S3, fetchMock as unknown as typeof fetch),
    ).rejects.toThrow('403');
  });
});

// Official AWS SigV4 documentation vectors (fixed example credentials from the docs).
describe('SigV4 official test vectors', () => {
  it('derives the documented signing key (IAM example, 20120215)', () => {
    const key = deriveSigningKey(
      'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
      '20120215',
      'us-east-1',
      'iam',
    );
    expect(key.toString('hex')).toBe(
      'f4780e2d9f65fa895f9c67b32ce1baf0b0d8a43505a000a1a9e090d414db404d',
    );
  });

  const EMPTY_SHA = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
  const creds = {
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    region: 'us-east-1',
    service: 's3',
    amzDate: '20130524T000000Z',
  };

  it('matches the documented GET Object signature (Range header)', () => {
    const r = signV4({
      ...creds,
      method: 'GET',
      canonicalUri: '/test.txt',
      headers: {
        host: 'examplebucket.s3.amazonaws.com',
        range: 'bytes=0-9',
        'x-amz-content-sha256': EMPTY_SHA,
        'x-amz-date': '20130524T000000Z',
      },
      payloadHash: EMPTY_SHA,
    });
    expect(r.signature).toBe('f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
    expect(r.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
    );
  });

  it('matches the documented PUT Object signature (encoded key, extra headers)', () => {
    const r = signV4({
      ...creds,
      method: 'PUT',
      canonicalUri: '/test%24file.text',
      headers: {
        date: 'Fri, 24 May 2013 00:00:00 GMT',
        host: 'examplebucket.s3.amazonaws.com',
        'x-amz-content-sha256': '44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072',
        'x-amz-date': '20130524T000000Z',
        'x-amz-storage-class': 'REDUCED_REDUNDANCY',
      },
      payloadHash: '44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072',
    });
    expect(r.signature).toBe('98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd');
  });
});

describe('runBackup', () => {
  it('snapshots and skips upload when S3 is not configured', async () => {
    const fetchMock = vi.fn();
    const res = await runBackup(db, opts(), fetchMock as unknown as typeof fetch);

    expect(res.ok).toBe(true);
    expect(res.uploaded).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(existsSync(res.path!)).toBe(true);
  });

  it('uploads when S3 is configured', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const res = await runBackup(db, opts({ s3: S3 }), fetchMock as unknown as typeof fetch);
    expect(res.uploaded).toBe(true);
  });

  it('keeps the local snapshot if the upload fails', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));
    const res = await runBackup(db, opts({ s3: S3 }), fetchMock as unknown as typeof fetch);

    expect(res.ok).toBe(true);
    expect(res.uploaded).toBe(false);
    expect(existsSync(res.path!)).toBe(true);
  });

  it('skips with no snapshot when free space is below the required threshold', async () => {
    const free = vi.fn().mockResolvedValue(0);
    const res = await runBackup(db, opts(), vi.fn() as unknown as typeof fetch, free);
    expect(res.ok).toBe(false);
    expect(res.skipped).toBe(true);
    expect(readdirSync(join(dir, 'backups'))).toEqual([]);
  });

  it('runs the backup with the exact prod numbers (free 3236851712, db ~1.49 GB)', async () => {
    fakeSizes.set(db.name, 1_486_970_880);
    const free = vi.fn().mockResolvedValue(3_236_851_712);
    const res = await runBackup(db, opts(), vi.fn() as unknown as typeof fetch, free);
    expect(res.skipped).toBeUndefined();
    expect(res.ok).toBe(true);
    expect(existsSync(res.path!)).toBe(true);
  });

  it('still skips when free space is really insufficient (1.2x db size)', async () => {
    const dbBytes = 1_486_970_880;
    fakeSizes.set(db.name, dbBytes);
    const free = vi.fn().mockResolvedValue(Math.round(1.2 * dbBytes));
    const res = await runBackup(db, opts(), vi.fn() as unknown as typeof fetch, free);
    expect(res.ok).toBe(false);
    expect(res.skipped).toBe(true);
    expect(readdirSync(join(dir, 'backups'))).toEqual([]);
  });

  it('requires 1.5x db size plus 128 MiB', () => {
    expect(requiredFreeBytes(1_000_000_000)).toBe(1_500_000_000 + 128 * 1024 * 1024);
  });

  it('rotates to keep-1 to make room, then proceeds if space suffices', async () => {
    const backups = join(dir, 'backups');
    mkdirSync(backups, { recursive: true });
    for (const d of ['01', '02', '03']) {
      writeFileSync(join(backups, `stremio-letterboxd-202601${d}T000000Z.db.gz`), 'x');
    }
    const free = vi
      .fn()
      .mockResolvedValueOnce(0)
      .mockResolvedValue(requiredFreeBytes(1_000_000_000));
    const res = await runBackup(db, opts({ keep: 3 }), vi.fn() as unknown as typeof fetch, free);
    expect(res.ok).toBe(true);
    const files = readdirSync(backups).sort();
    expect(files).toHaveLength(3);
    expect(files).not.toContain('stremio-letterboxd-20260101T000000Z.db.gz');
  });

  it('removes orphaned .tmp files before running', async () => {
    const backups = join(dir, 'backups');
    mkdirSync(backups, { recursive: true });
    writeFileSync(join(backups, 'stremio-letterboxd-20260101T000000Z.db.tmp'), 'x');
    await runBackup(db, opts());
    expect(readdirSync(backups).some((f) => f.endsWith('.tmp'))).toBe(false);
  });

  it('never throws and reports failure', async () => {
    db.close();
    const res = await runBackup(db, opts());
    expect(res.ok).toBe(false);
  });

  it('refuses concurrent runs', async () => {
    const [a, b] = await Promise.all([runBackup(db, opts()), runBackup(db, opts())]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
  });
});

describe('cleanupOrphans', () => {
  it('removes only tmp leftovers', () => {
    const backups = join(dir, 'backups');
    mkdirSync(backups, { recursive: true });
    writeFileSync(join(backups, 'stremio-letterboxd-20260101T000000Z.db.tmp'), 'x');
    writeFileSync(join(backups, 'stremio-letterboxd-20260101T000000Z.db.gz.tmp'), 'x');
    writeFileSync(join(backups, 'stremio-letterboxd-20260101T000000Z.db.gz'), 'x');
    expect(cleanupOrphans(backups)).toBe(2);
    expect(readdirSync(backups)).toEqual(['stremio-letterboxd-20260101T000000Z.db.gz']);
  });
});

describe('startBackupScheduler', () => {
  const fake = () =>
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'] });

  it('is a no-op when disabled', () => {
    fake();
    const stop = startBackupScheduler(() => db, opts({ enabled: false }));
    expect(vi.getTimerCount()).toBe(0);
    stop();
  });

  it('defers the first run, then runs, and stops cleanly', async () => {
    fake();
    const stop = startBackupScheduler(() => db, opts({ initialDelayMs: 100, intervalMs: 1000 }));
    expect(existsSync(join(dir, 'backups'))).toBe(false);

    await vi.advanceTimersByTimeAsync(101);
    await vi.waitFor(() => expect(readdirSync(join(dir, 'backups')).length).toBe(1), {
      interval: 5,
    });
    stop();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('backupOptionsFromEnv', () => {
  const base = envSchema.parse({ ...process.env });

  it('uses safe defaults and no S3 target', () => {
    const o = backupOptionsFromEnv(base);
    expect(o.enabled).toBe(true);
    expect(o.intervalMs).toBe(24 * 3_600_000);
    expect(o.keep).toBe(3);
    expect(o.s3).toBeNull();
  });

  it('can be disabled and enables S3 only when all vars are set', () => {
    expect(backupOptionsFromEnv(envSchema.parse({ ...process.env, BACKUP_ENABLED: 'false' })).enabled).toBe(false);
    const partial = envSchema.parse({ ...process.env, BACKUP_S3_BUCKET: 'b' });
    expect(backupOptionsFromEnv(partial).s3).toBeNull();
    const full = envSchema.parse({
      ...process.env,
      BACKUP_S3_ENDPOINT: 'https://s3.example.test',
      BACKUP_S3_BUCKET: 'b',
      BACKUP_S3_ACCESS_KEY_ID: 'id',
      BACKUP_S3_SECRET_ACCESS_KEY: 'sk',
      BACKUP_S3_PREFIX: 'x',
    });
    expect(backupOptionsFromEnv(full).s3?.prefix).toBe('x/');
  });
});
