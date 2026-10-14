import { describe, it, expect, beforeEach } from "vitest";
import {
  CHECKOUT_INTENT_KEY,
  CHECKOUT_INTENT_TTL_MS,
  clearPurchasedOffer,
  dismissSupporterBanner,
  isSupporterBannerDismissed,
  peekCheckoutIntent,
  readPurchasedOffer,
  rememberPurchasedOffer,
  saveCheckoutIntent,
  takeCheckoutIntent,
} from "../../src/lib/supporter-storage";

class MemoryStorage {
  store = new Map<string, string>();
  getItem(key: string) {
    return this.store.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.store.set(key, value);
  }
  removeItem(key: string) {
    this.store.delete(key);
  }
}

const throwing = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
  removeItem: () => {
    throw new Error("blocked");
  },
};

let storage: MemoryStorage;
const get = () => storage;
const T0 = 1_000_000;

beforeEach(() => {
  storage = new MemoryStorage();
});

describe("checkout intent", () => {
  it("returns a fresh intent once, then nothing", () => {
    saveCheckoutIntent("founder", T0, get);
    expect(takeCheckoutIntent(T0 + 1000, get)).toBe("founder");
    expect(takeCheckoutIntent(T0 + 2000, get)).toBeNull();
  });

  it("peek does not consume the intent", () => {
    saveCheckoutIntent("supporter", T0, get);
    expect(peekCheckoutIntent(T0 + 1000, get)).toBe("supporter");
    expect(takeCheckoutIntent(T0 + 1000, get)).toBe("supporter");
  });

  it("ignores and clears an expired intent", () => {
    saveCheckoutIntent("supporter", T0, get);
    expect(peekCheckoutIntent(T0 + CHECKOUT_INTENT_TTL_MS, get)).toBeNull();
    expect(storage.getItem(CHECKOUT_INTENT_KEY)).toBeNull();
  });

  it("ignores malformed or unknown values", () => {
    storage.setItem(CHECKOUT_INTENT_KEY, "not json");
    expect(takeCheckoutIntent(T0, get)).toBeNull();
    storage.setItem(CHECKOUT_INTENT_KEY, JSON.stringify({ offer: "lifetime", at: T0 }));
    expect(takeCheckoutIntent(T0, get)).toBeNull();
  });

  it("returns null when nothing is stored or storage is missing", () => {
    expect(takeCheckoutIntent(T0, get)).toBeNull();
    expect(takeCheckoutIntent(T0, () => null)).toBeNull();
  });

  it("never throws when storage throws", () => {
    expect(() => saveCheckoutIntent("founder", T0, () => throwing)).not.toThrow();
    expect(peekCheckoutIntent(T0, () => throwing)).toBeNull();
    expect(takeCheckoutIntent(T0, () => throwing)).toBeNull();
  });
});

describe("purchased offer", () => {
  it("stores, reads and clears the offer", () => {
    rememberPurchasedOffer("founder", get);
    expect(readPurchasedOffer(get)).toBe("founder");
    clearPurchasedOffer(get);
    expect(readPurchasedOffer(get)).toBeNull();
  });

  it("never throws when storage throws", () => {
    expect(() => rememberPurchasedOffer("founder", () => throwing)).not.toThrow();
    expect(readPurchasedOffer(() => throwing)).toBeNull();
    expect(() => clearPurchasedOffer(() => throwing)).not.toThrow();
  });
});

describe("supporter banner dismissal", () => {
  it("stays dismissed once dismissed", () => {
    expect(isSupporterBannerDismissed(get)).toBe(false);
    dismissSupporterBanner(get);
    expect(isSupporterBannerDismissed(get)).toBe(true);
  });

  it("shows the banner when storage throws", () => {
    expect(isSupporterBannerDismissed(() => throwing)).toBe(false);
    expect(() => dismissSupporterBanner(() => throwing)).not.toThrow();
  });
});
