import type { CheckoutOffer } from "./billing";

/**
 * Small browser-storage helpers for the supporter flow. Every read and write
 * is wrapped: private windows, blocked site data or SSR make storage throw or
 * vanish, and the pages must keep working without it.
 */

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type StorageGetter = () => StorageLike | null | undefined;

export const CHECKOUT_INTENT_KEY = "stremboxd.checkoutIntent";
export const PURCHASED_OFFER_KEY = "stremboxd.checkoutOffer";
export const SUPPORTER_BANNER_DISMISSED_KEY = "stremboxd.supporterBannerDismissed";
export const CHECKOUT_INTENT_TTL_MS = 30 * 60 * 1000;

const sessionStore: StorageGetter = () => (typeof window === "undefined" ? null : window.sessionStorage);
const localStore: StorageGetter = () => (typeof window === "undefined" ? null : window.localStorage);

function read(getStorage: StorageGetter, key: string): string | null {
  try {
    return getStorage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(getStorage: StorageGetter, key: string, value: string): void {
  try {
    getStorage()?.setItem(key, value);
  } catch {
    // Storage unavailable: the flow simply forgets, nothing breaks.
  }
}

function remove(getStorage: StorageGetter, key: string): void {
  try {
    getStorage()?.removeItem(key);
  } catch {
    // Nothing to clear when storage is unavailable.
  }
}

function isOffer(value: unknown): value is CheckoutOffer {
  return value === "supporter" || value === "founder";
}

/** Remembers a checkout the user tried to open while logged out. */
export function saveCheckoutIntent(offer: CheckoutOffer, now = Date.now(), getStorage = sessionStore): void {
  write(getStorage, CHECKOUT_INTENT_KEY, JSON.stringify({ offer, at: now }));
}

function readIntent(now: number, getStorage: StorageGetter): CheckoutOffer | null {
  const raw = read(getStorage, CHECKOUT_INTENT_KEY);
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as { offer?: unknown; at?: unknown };
    const fresh =
      typeof parsed.at === "number" && parsed.at <= now && now - parsed.at < CHECKOUT_INTENT_TTL_MS;
    if (isOffer(parsed.offer) && fresh) return parsed.offer;
  } catch {
    // Malformed value: treated as absent and cleared below.
  }
  remove(getStorage, CHECKOUT_INTENT_KEY);
  return null;
}

/** Whether a fresh intent exists, without consuming it. Expired ones are cleared. */
export function peekCheckoutIntent(now = Date.now(), getStorage = sessionStore): CheckoutOffer | null {
  return readIntent(now, getStorage);
}

/** Returns a fresh intent once, then forgets it. */
export function takeCheckoutIntent(now = Date.now(), getStorage = sessionStore): CheckoutOffer | null {
  const offer = readIntent(now, getStorage);
  remove(getStorage, CHECKOUT_INTENT_KEY);
  return offer;
}

/** The offer just paid for, so the post-checkout screen can adapt to it. */
export function rememberPurchasedOffer(offer: CheckoutOffer, getStorage = sessionStore): void {
  write(getStorage, PURCHASED_OFFER_KEY, offer);
}

export function readPurchasedOffer(getStorage = sessionStore): CheckoutOffer | null {
  const value = read(getStorage, PURCHASED_OFFER_KEY);
  return isOffer(value) ? value : null;
}

export function clearPurchasedOffer(getStorage = sessionStore): void {
  remove(getStorage, PURCHASED_OFFER_KEY);
}

export function isSupporterBannerDismissed(getStorage = localStore): boolean {
  return read(getStorage, SUPPORTER_BANNER_DISMISSED_KEY) === "1";
}

export function dismissSupporterBanner(getStorage = localStore): void {
  write(getStorage, SUPPORTER_BANNER_DISMISSED_KEY, "1");
}
