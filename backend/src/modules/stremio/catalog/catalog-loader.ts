import type { StremioMeta } from '../catalog.service.js';
import { createChildLogger } from '../../../lib/logger.js';

const logger = createChildLogger('catalog-loader');

/** One upstream catalog, fetched page by page and stored whole once complete. */
export interface CatalogSource<T> {
  /** Cache key of the full catalog — also identifies the in-flight load. */
  key: string;
  maxPages: number;
  fetchPage: (cursor: string | undefined) => Promise<{ items: T[]; cursor?: string }>;
  /** Turns one upstream page into metas, in order. */
  toMetas: (items: T[]) => Promise<StremioMeta[]>;
  /** Drop a meta whose id an earlier page already produced (keeps the first). */
  dedupe?: boolean;
  /** Reorders the full catalog (e.g. shuffle): pages then wait for every upstream page. */
  finalize?: (metas: StremioMeta[]) => StremioMeta[];
  /** Saves the full catalog. Called once, after the last page. */
  store: (metas: StremioMeta[]) => void;
}

interface Load {
  metas: StremioMeta[];
  settled: boolean;
  failed: boolean;
  error: unknown;
  waiters: Array<() => void>;
  complete: Promise<StremioMeta[]>;
}

const loads = new Map<string, Load>();

function wake(load: Load): void {
  const waiters = load.waiters;
  load.waiters = [];
  for (const waiter of waiters) waiter();
}

function startLoad<T>(source: CatalogSource<T>): Load {
  const load: Load = { metas: [], settled: false, failed: false, error: undefined, waiters: [], complete: Promise.resolve([]) };
  // Registered before the first fetch so a synchronous failure can't leave a dead entry behind.
  loads.set(source.key, load);

  load.complete = (async () => {
    const seen = new Set<string>();
    let cursor: string | undefined;
    let page = 0;
    try {
      do {
        page++;
        const response = await source.fetchPage(cursor);
        for (const meta of await source.toMetas(response.items)) {
          if (source.dedupe) {
            if (seen.has(meta.id)) continue;
            seen.add(meta.id);
          }
          load.metas.push(meta);
        }
        cursor = response.cursor;
        wake(load);
      } while (cursor && page < source.maxPages);

      const full = source.finalize ? source.finalize(load.metas) : load.metas;
      source.store(full);
      load.metas = full;
      return full;
    } catch (err) {
      load.failed = true;
      load.error = err;
      throw err;
    } finally {
      load.settled = true;
      if (loads.get(source.key) === load) loads.delete(source.key);
      wake(load);
    }
  })();
  // Callers get the failure through loadCatalogPage; a refresh nobody awaits must not crash.
  load.complete.catch((err: unknown) => {
    logger.warn({ err, key: source.key, loaded: load.metas.length }, 'Catalog load failed');
  });
  return load;
}

function loadFor<T>(source: CatalogSource<T>): Load {
  return loads.get(source.key) ?? startLoad(source);
}

/**
 * One page of a catalog, fetched without waiting for the pages after it.
 *
 * Concurrent requests for the same catalog share a single upstream load. The page
 * is the exact slice the complete catalog will have, since pages are appended in
 * order. The full catalog is stored once the last upstream page has arrived.
 */
export async function loadCatalogPage<T>(
  source: CatalogSource<T>,
  skip: number,
  pageSize: number,
): Promise<StremioMeta[]> {
  const load = loadFor(source);

  if (source.finalize) {
    return (await load.complete).slice(skip, skip + pageSize);
  }

  const needed = skip + pageSize;
  while (!load.settled && load.metas.length < needed) {
    await new Promise<void>((resolve) => load.waiters.push(resolve));
  }
  if (load.failed && load.metas.length < needed) throw load.error;
  return load.metas.slice(skip, skip + pageSize);
}

/**
 * Starts loading a catalog in the background unless it is already loading.
 * Used to refresh a stale catalog while its cached copy keeps being served.
 */
export function refreshCatalog<T>(source: CatalogSource<T>): void {
  loadFor(source);
}

/**
 * The full catalog currently being loaded under `key`, or undefined when none is.
 * Resolves to undefined if that load fails.
 */
export function inflightCatalog(key: string): Promise<StremioMeta[] | undefined> | undefined {
  const load = loads.get(key);
  return load?.complete.catch(() => undefined);
}
