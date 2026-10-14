import { authHeaders } from "./session-token";
import { track, type AnalyticsEvents } from "./analytics";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? "https://api.stremboxd.com";

export type CheckoutOffer = "supporter" | "founder";

export type SupporterReason = AnalyticsEvents["supporter_reason_answered"]["reason"];

/** Never throws: the answer is optional, losing it must not surface to the user. */
export async function sendSupporterReason(reason: SupporterReason): Promise<void> {
  try {
    await fetch(`${BACKEND_URL}/billing/reason`, {
      method: "POST",
      credentials: "include",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
  } catch {
    // swallow: best effort
  }
}

export interface Offer {
  founderAvailable: boolean;
}

/** Never throws: without the offer, /pricing simply shows no Founder block. */
export async function fetchOffer(): Promise<Offer | null> {
  try {
    const response = await fetch(`${BACKEND_URL}/billing/offer`);
    if (!response.ok) return null;
    return (await response.json()) as Offer;
  } catch {
    return null;
  }
}

/**
 * Thrown by openCheckout() when the backend refuses to create a checkout.
 * Carries the HTTP status so callers can tell "not logged in" (401) apart
 * from any other failure worth a generic retry message.
 */
export class CheckoutError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`Could not start checkout (status ${status})`);
    this.name = "CheckoutError";
    this.status = status;
  }
}

// create()'s promise only resolves once the embed's iframe posts back a
// "loaded" message; if polar.sh is unreachable that never happens, so we
// need our own timeout. Generous on purpose — a false timeout tears down an
// iframe that was still loading fine.
const CHECKOUT_LOAD_TIMEOUT_MS = 30_000;

/**
 * `create()` synchronously appends a loading spinner to `document.body` and
 * adds the `polar-no-scroll` class before the iframe (and its own "loaded"
 * listener) exist. If we give up waiting, undo exactly that so the page
 * isn't left with a stuck spinner and locked scroll.
 */
function cleanupStuckCheckoutEmbed(checkoutOrigin: string): void {
  document.body.classList.remove("polar-no-scroll");
  document.querySelectorAll(".polar-loader-spinner").forEach((spinner) => {
    spinner.parentElement?.remove();
  });
  document.querySelectorAll(`iframe[src^="${checkoutOrigin}"]`).forEach((iframe) => {
    iframe.remove();
  });
}

/**
 * Opens the Polar checkout as an overlay on the current page. The JS context
 * is kept, so the in-memory session token survives the payment. `onSuccess`
 * runs instead of Polar's own redirect.
 */
export async function openCheckout(onSuccess: () => void, offer: CheckoutOffer = "supporter"): Promise<void> {
  const response = await fetch(`${BACKEND_URL}/billing/checkout`, {
    method: "POST",
    credentials: "include",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ offer }),
  });

  if (!response.ok) {
    throw new CheckoutError(response.status);
  }

  const { url } = (await response.json()) as { url: string };

  // Loaded on click only: the checkout bundle stays out of every page load.
  const { PolarEmbedCheckout } = await import("@polar-sh/checkout/embed");

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      cleanupStuckCheckoutEmbed(new URL(url).origin);
      reject(new Error("Checkout embed timed out while loading"));
    }, CHECKOUT_LOAD_TIMEOUT_MS);
  });

  let checkout: Awaited<ReturnType<typeof PolarEmbedCheckout.create>>;
  try {
    checkout = await Promise.race([
      PolarEmbedCheckout.create(url, {
        theme: "dark",
        // Per Polar's docs, this fires reliably even when create()'s own
        // promise settles a tick late — safer than relying on the promise alone.
        onLoaded: () => clearTimeout(timeoutId),
      }),
      timeout,
    ]);
  } finally {
    clearTimeout(timeoutId);
  }

  track("checkout_opened");

  checkout.addEventListener("success", (event) => {
    event.preventDefault();
    track("checkout_completed");
    // We navigate ourselves instead of following Polar's redirect, so we
    // must also do the teardown that handleSuccess() would otherwise have
    // done: close the embed (removes the iframe, message listener, and the
    // scroll-lock class) before running our own success callback.
    checkout.close();
    onSuccess();
  });
}
