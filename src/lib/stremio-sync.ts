const LINK_API = "https://link.stremio.com/api/v2";
const STREMIO_API = "https://api.strem.io/api";
const AUTH_ERROR_CODES = new Set([1, 101]);

export interface LinkCode {
  code: string;
  link: string;
  qrcode: string;
}

export interface PollOptions {
  intervalMs?: number;
  timeoutMs?: number;
}

export type SyncResult = "synced" | "not-installed" | "unauthorized";

interface ApiEnvelope<T> {
  result?: T;
  error?: { message?: string; code?: number };
}

interface AddonDescriptor {
  transportUrl: string;
  manifest: unknown;
  flags?: unknown;
}

async function getEnvelope<T>(url: string, signal?: AbortSignal): Promise<ApiEnvelope<T>> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`Stremio request failed with status ${response.status}`);
  }
  return (await response.json()) as ApiEnvelope<T>;
}

async function postEnvelope<T>(path: string, payload: unknown): Promise<ApiEnvelope<T>> {
  const response = await fetch(`${STREMIO_API}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`Stremio request failed with status ${response.status}`);
  }
  return (await response.json()) as ApiEnvelope<T>;
}

export async function syncAddon(authKey: string, manifestUrl: string): Promise<SyncResult> {
  const collection = await postEnvelope<{ addons: AddonDescriptor[] }>("addonCollectionGet", {
    authKey,
    update: true,
  });

  if (collection.error) {
    if (AUTH_ERROR_CODES.has(collection.error.code ?? -1)) {
      clearAuthKey();
      return "unauthorized";
    }
    throw new Error(collection.error.message ?? "Could not read the Stremio addon collection");
  }

  const addons = collection.result?.addons;
  // Guard: never write back a collection we did not fully read. An empty or
  // malformed read would otherwise wipe every addon on the account.
  if (!Array.isArray(addons) || addons.length === 0) {
    throw new Error("Could not read the Stremio addon collection");
  }

  const index = addons.findIndex((addon) => addon.transportUrl === manifestUrl);
  if (index === -1) return "not-installed";

  const manifestResponse = await fetch(manifestUrl);
  if (!manifestResponse.ok) {
    throw new Error(`Could not read the addon manifest (status ${manifestResponse.status})`);
  }
  const manifest = (await manifestResponse.json()) as unknown;
  if (typeof manifest !== "object" || manifest === null || !("id" in manifest)) {
    throw new Error("Fetched addon manifest is not valid");
  }

  const next = addons.map((addon, i) => (i === index ? { ...addon, manifest } : addon));

  const saved = await postEnvelope<{ success: boolean }>("addonCollectionSet", {
    authKey,
    addons: next,
  });

  if (saved.error) {
    if (AUTH_ERROR_CODES.has(saved.error.code ?? -1)) {
      clearAuthKey();
      return "unauthorized";
    }
    throw new Error(saved.error.message ?? "Could not update the Stremio addon collection");
  }

  return "synced";
}

/**
 * The locale stored on the Stremio account (e.g. "fr-FR"). It is not the language
 * Stremio's interface is set to. undefined when it can't be read — callers treat it
 * as a hint only.
 */
export async function getStremioAccountLocale(authKey: string): Promise<string | undefined> {
  try {
    const envelope = await postEnvelope<{ lang?: string }>("getUser", { type: "GetUser", authKey });
    return envelope.result?.lang || undefined;
  } catch {
    return undefined;
  }
}

export async function createLinkCode(): Promise<LinkCode> {
  const envelope = await getEnvelope<LinkCode>(`${LINK_API}/create`);
  if (!envelope.result) {
    throw new Error(envelope.error?.message ?? "Could not create a Stremio link code");
  }
  const { code, link, qrcode } = envelope.result;
  return { code, link, qrcode };
}

export async function pollAuthKey(
  code: string,
  signal: AbortSignal,
  options: PollOptions = {},
): Promise<string> {
  const intervalMs = options.intervalMs ?? 2000;
  const timeoutMs = options.timeoutMs ?? 120000;
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    if (signal.aborted) throw new Error("Stremio linking aborted");

    let envelope: ApiEnvelope<{ authKey?: string }>;
    try {
      envelope = await getEnvelope<{ authKey?: string }>(
        `${LINK_API}/read?code=${encodeURIComponent(code)}`,
        signal,
      );
    } catch (error) {
      if (signal.aborted) throw new Error("Stremio linking aborted");
      throw error;
    }
    const authKey = envelope.result?.authKey;
    if (authKey) return authKey;

    if (Date.now() >= deadline) throw new Error("Stremio linking timed out");
    await sleepOrAbort(intervalMs, signal);
  }
}

// Resolves after `ms`, or immediately if `signal` aborts first. Always cleans
// up its timer and listener on settle so neither leaks past this call.
export function sleepOrAbort(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export const AUTH_KEY_STORAGE_KEY = "configure:stremio-auth-key";

export function readAuthKey(): string | null {
  try {
    return localStorage.getItem(AUTH_KEY_STORAGE_KEY);
  } catch {
    // Private mode or blocked storage: behave as if no account was linked.
    return null;
  }
}

export function storeAuthKey(key: string): void {
  try {
    localStorage.setItem(AUTH_KEY_STORAGE_KEY, key);
  } catch {
    // Linking still works for this session, it just will not be remembered.
  }
}

export function clearAuthKey(): void {
  try {
    localStorage.removeItem(AUTH_KEY_STORAGE_KEY);
  } catch {
    // Nothing to clear when storage is unavailable.
  }
}
