/**
 * Scheduled SQLite snapshots, gzip-compressed (.db.gz), optional streamed S3 upload.
 *
 * Restore: stop the app, `gunzip stremio-letterboxd-<stamp>.db.gz`, replace the live
 * database file with the result, delete the stale `-wal` and `-shm` files next to it,
 * then start the app with the SAME ENCRYPTION_KEY (refresh tokens are encrypted with it).
 */
import Database from 'better-sqlite3';
import { createHash, createHmac } from 'node:crypto';
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import { statfs } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import type { Env } from '../config/env.schema.js';
import { createChildLogger } from './logger.js';

const logger = createChildLogger('backup');

const FILE_PREFIX = 'stremio-letterboxd-';
const FILE_RE = /^stremio-letterboxd-\d{8}T\d{6}Z\.db(\.gz)?$/;
const ORPHAN_RE = /^stremio-letterboxd-.*\.tmp(-wal|-shm)?$/;
/**
 * Real disk peak of one snapshot: the raw temporary copy (~1x the database size) plus
 * the gzip output written while the raw copy still exists (~0.3 to 0.6x, not measured).
 * 1.5x covers that peak with headroom; the old 2x was too conservative and skipped
 * backups that would have fit.
 */
const SPACE_FACTOR = 1.5;
/** Fixed free space kept on top of the estimated peak (filesystem slack, WAL growth). */
const SPACE_MARGIN_BYTES = 128 * 1024 * 1024;
/** A single S3 PUT is capped at 5 GiB; a gzip'd snapshot stays far below that. */
const MAX_SINGLE_PUT_BYTES = 5 * 1024 ** 3;
const UPLOAD_TIMEOUT_MS = 120_000;

export interface S3Target {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  prefix: string;
}

export interface BackupOptions {
  enabled: boolean;
  dir: string;
  intervalMs: number;
  initialDelayMs: number;
  keep: number;
  /** null: off-volume upload disabled (no-op). */
  s3: S3Target | null;
}

export interface BackupResult {
  ok: boolean;
  path?: string;
  uploaded: boolean;
  removed: number;
  /** True when the run was skipped (not enough disk space, or already running). */
  skipped?: boolean;
}

/** Maps validated env to scheduler options. S3 is on only if all four core vars are set. */
export function backupOptionsFromEnv(env: Env): BackupOptions {
  const { BACKUP_S3_ENDPOINT, BACKUP_S3_BUCKET, BACKUP_S3_ACCESS_KEY_ID, BACKUP_S3_SECRET_ACCESS_KEY } =
    env;
  let s3: S3Target | null = null;
  if (
    BACKUP_S3_ENDPOINT &&
    BACKUP_S3_BUCKET &&
    BACKUP_S3_ACCESS_KEY_ID &&
    BACKUP_S3_SECRET_ACCESS_KEY
  ) {
    try {
      new URL(BACKUP_S3_ENDPOINT);
      const prefix = env.BACKUP_S3_PREFIX;
      s3 = {
        endpoint: BACKUP_S3_ENDPOINT,
        bucket: BACKUP_S3_BUCKET,
        region: env.BACKUP_S3_REGION,
        accessKeyId: BACKUP_S3_ACCESS_KEY_ID,
        secretAccessKey: BACKUP_S3_SECRET_ACCESS_KEY,
        prefix: prefix && !prefix.endsWith('/') ? `${prefix}/` : prefix,
      };
    } catch {
      logger.error('BACKUP_S3_ENDPOINT is not a valid URL, remote upload disabled');
    }
  }
  return {
    enabled: env.BACKUP_ENABLED,
    dir: env.BACKUP_DIR ?? join(dirname(env.DATABASE_PATH), 'backups'),
    intervalMs: Math.round(env.BACKUP_INTERVAL_HOURS * 3_600_000),
    initialDelayMs: Math.round(env.BACKUP_INITIAL_DELAY_MINUTES * 60_000),
    keep: env.BACKUP_KEEP,
    s3,
  };
}

function stamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function defaultIntegrityCheck(path: string): string {
  const copy = new Database(path);
  try {
    const rows = copy.pragma('integrity_check') as Array<{ integrity_check: string }>;
    const result = rows.map((r) => r.integrity_check).join(';');
    // Make the snapshot a single self-contained file (no WAL sidecars).
    copy.pragma('journal_mode = DELETE');
    return result;
  } finally {
    copy.close();
  }
}

/** Removes leftover .tmp snapshots (crash mid-backup). Returns removed count. */
export function cleanupOrphans(dir: string): number {
  if (!existsSync(dir)) return 0;
  let n = 0;
  for (const f of readdirSync(dir)) {
    if (ORPHAN_RE.test(f)) {
      rmSync(join(dir, f), { force: true });
      n++;
    }
  }
  return n;
}

async function defaultFreeSpace(dir: string): Promise<number> {
  const s = await statfs(dir);
  return Number(s.bavail) * Number(s.bsize);
}

/** Bytes of free space required before writing a snapshot of a database of `dbBytes`. */
export function requiredFreeBytes(dbBytes: number): number {
  return Math.ceil(SPACE_FACTOR * dbBytes) + SPACE_MARGIN_BYTES;
}

/**
 * Consistent snapshot through the SQLite online backup API (async, yields to the
 * event loop between page batches). Never a raw file copy: WAL content is included.
 * The raw copy is integrity-checked, then gzip-streamed to `.db.gz`; the raw copy is
 * always deleted afterwards. The final name only appears once everything succeeded.
 */
export async function takeSnapshot(
  db: Database.Database,
  dir: string,
  now: Date = new Date(),
  integrityCheck: (path: string) => string = defaultIntegrityCheck,
): Promise<string> {
  mkdirSync(dir, { recursive: true });
  const finalPath = join(dir, `${FILE_PREFIX}${stamp(now)}.db.gz`);
  const rawTmp = join(dir, `${FILE_PREFIX}${stamp(now)}.db.tmp`);
  const gzTmp = `${finalPath}.tmp`;

  try {
    await db.backup(rawTmp);
    if (integrityCheck(rawTmp) !== 'ok') {
      // Never include the check output: it can quote database content.
      throw new Error('Snapshot integrity check failed');
    }
    await pipeline(createReadStream(rawTmp), createGzip(), createWriteStream(gzTmp));
    rmSync(rawTmp, { force: true });
    renameSync(gzTmp, finalPath);
    return finalPath;
  } finally {
    for (const f of [rawTmp, `${rawTmp}-wal`, `${rawTmp}-shm`, gzTmp]) {
      rmSync(f, { force: true });
    }
  }
}

/** Keeps the `keep` newest snapshots (names sort chronologically). Returns removed paths. */
export function rotateBackups(dir: string, keep: number): string[] {
  if (keep < 1 || !existsSync(dir)) return [];
  const files = readdirSync(dir)
    .filter((f) => FILE_RE.test(f))
    .sort()
    .reverse();
  const removed: string[] = [];
  for (const f of files.slice(keep)) {
    const p = join(dir, f);
    rmSync(p, { force: true });
    removed.push(p);
  }
  return removed;
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

function sha256Hex(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

/** SigV4 signing key: HMAC chain over date, region, service, "aws4_request". */
export function deriveSigningKey(
  secretAccessKey: string,
  date: string,
  region: string,
  service: string,
): Buffer {
  const kDate = hmac(`AWS4${secretAccessKey}`, date);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, 'aws4_request');
}

export interface SigV4Input {
  method: string;
  /** Already URI-encoded absolute path. */
  canonicalUri: string;
  canonicalQuery?: string;
  /** Headers to sign (names case-insensitive). */
  headers: Record<string, string>;
  payloadHash: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service: string;
  /** ISO basic format, e.g. 20130524T000000Z. */
  amzDate: string;
}

/** Builds the canonical request, string to sign and Authorization header value. */
export function signV4(input: SigV4Input): {
  canonicalRequest: string;
  signedHeaders: string;
  signature: string;
  authorization: string;
} {
  const names = Object.keys(input.headers)
    .map((h) => h.toLowerCase())
    .sort();
  const lower = new Map(
    Object.entries(input.headers).map(([k, v]) => [k.toLowerCase(), v.trim().replace(/\s+/g, ' ')]),
  );
  const canonicalHeaders = names.map((n) => `${n}:${lower.get(n)}\n`).join('');
  const signedHeaders = names.join(';');
  const canonicalRequest = [
    input.method,
    input.canonicalUri,
    input.canonicalQuery ?? '',
    canonicalHeaders,
    signedHeaders,
    input.payloadHash,
  ].join('\n');

  const date = input.amzDate.slice(0, 8);
  const scope = `${date}/${input.region}/${input.service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', input.amzDate, scope, sha256Hex(canonicalRequest)].join(
    '\n',
  );
  const kSigning = deriveSigningKey(input.secretAccessKey, date, input.region, input.service);
  const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');
  return {
    canonicalRequest,
    signedHeaders,
    signature,
    authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

/**
 * Minimal AWS Signature V4 PUT (path-style), works with S3-compatible stores.
 * The file is streamed (never loaded in memory) with a known Content-Length and an
 * UNSIGNED-PAYLOAD hash, which is only allowed over HTTPS. A single PUT is capped at
 * 5 GiB by S3; gzip'd snapshots stay far below that (a larger file is refused).
 */
export async function uploadToS3(
  filePath: string,
  objectName: string,
  s3: S3Target,
  fetchImpl: typeof fetch = fetch,
  now: Date = new Date(),
): Promise<void> {
  const base = new URL(s3.endpoint);
  if (base.protocol !== 'https:') {
    throw new Error('Remote upload requires an https endpoint (unsigned payload)');
  }
  const size = statSync(filePath).size;
  if (size > MAX_SINGLE_PUT_BYTES) {
    throw new Error('Snapshot exceeds the 5 GiB single PUT limit');
  }

  const key = `${s3.prefix}${objectName}`;
  const encodedPath =
    '/' + [s3.bucket, ...key.split('/')].map((seg) => encodeURIComponent(seg)).join('/');
  const amzDate = stamp(now);
  const payloadHash = 'UNSIGNED-PAYLOAD';

  const { authorization } = signV4({
    method: 'PUT',
    canonicalUri: encodedPath,
    headers: { host: base.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate },
    payloadHash,
    accessKeyId: s3.accessKeyId,
    secretAccessKey: s3.secretAccessKey,
    region: s3.region,
    service: 's3',
    amzDate,
  });

  const nodeStream = createReadStream(filePath);
  try {
    const res = await fetchImpl(`${base.origin}${encodedPath}`, {
      method: 'PUT',
      headers: {
        'x-amz-date': amzDate,
        'x-amz-content-sha256': payloadHash,
        authorization,
        'content-type': 'application/octet-stream',
        'content-length': String(size),
      },
      body: Readable.toWeb(nodeStream) as unknown as ReadableStream,
      duplex: 'half',
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    } as RequestInit);
    if (!res.ok) {
      throw new Error(`Upload failed with status ${res.status}`);
    }
  } finally {
    nodeStream.destroy();
  }
}

let running = false;

/** One backup cycle. Never throws; a failure at any step is logged (message only). */
export async function runBackup(
  db: Database.Database,
  options: BackupOptions,
  fetchImpl: typeof fetch = fetch,
  freeSpace: (dir: string) => Promise<number> = defaultFreeSpace,
): Promise<BackupResult> {
  if (running) {
    logger.warn('Backup already running, skipping');
    return { ok: false, uploaded: false, removed: 0, skipped: true };
  }
  running = true;
  try {
    mkdirSync(options.dir, { recursive: true });
    const orphans = cleanupOrphans(options.dir);
    if (orphans > 0) logger.warn({ orphans }, 'Removed orphaned temporary snapshots');

    let removed = 0;
    const need = requiredFreeBytes(statSync(db.name).size);
    if ((await freeSpace(options.dir)) < need) {
      // Make room first: drop the oldest so that the new snapshot fits the keep ceiling.
      removed += rotateBackups(options.dir, options.keep - 1).length;
      const free = await freeSpace(options.dir);
      if (free < need) {
        logger.warn(
          { freeBytes: free, neededBytes: need },
          'Not enough free disk space, backup skipped',
        );
        return { ok: false, uploaded: false, removed, skipped: true };
      }
    }

    const path = await takeSnapshot(db, options.dir);
    removed += rotateBackups(options.dir, options.keep).length;
    logger.info({ file: basename(path), removed }, 'Database snapshot created');

    let uploaded = false;
    if (options.s3) {
      try {
        await uploadToS3(path, basename(path), options.s3, fetchImpl);
        uploaded = true;
        logger.info('Snapshot uploaded to remote storage');
      } catch (error) {
        logger.error(
          { err: error instanceof Error ? error.message : 'unknown error' },
          'Remote upload failed (local snapshot kept)',
        );
      }
    } else {
      logger.debug('Remote storage not configured, skipping upload');
    }
    return { ok: true, path, uploaded, removed };
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error.message : 'unknown error' },
      'Database backup failed',
    );
    return { ok: false, uploaded: false, removed: 0 };
  } finally {
    running = false;
  }
}

/** Starts the in-process schedule. Timers are unref'd. Returns a stop function. */
export function startBackupScheduler(
  getDb: () => Database.Database,
  options: BackupOptions,
): () => void {
  if (!options.enabled) {
    logger.info('Database backups disabled');
    return () => {};
  }
  if (!options.s3) {
    logger.info('Remote backup storage not configured: snapshots stay on the local volume only');
  }

  try {
    cleanupOrphans(options.dir);
  } catch {
    logger.warn('Could not clean orphaned temporary snapshots at startup');
  }

  const tick = () => {
    try {
      void runBackup(getDb(), options);
    } catch (error) {
      logger.error(
        { err: error instanceof Error ? error.message : 'unknown error' },
        'Backup tick failed',
      );
    }
  };
  let interval: NodeJS.Timeout | undefined;
  const first = setTimeout(() => {
    tick();
    interval = setInterval(tick, options.intervalMs);
    interval.unref();
  }, options.initialDelayMs);
  first.unref();

  logger.info(
    { everyMs: options.intervalMs, keep: options.keep, remote: Boolean(options.s3) },
    'Database backups scheduled',
  );

  return () => {
    clearTimeout(first);
    if (interval) clearInterval(interval);
  };
}
