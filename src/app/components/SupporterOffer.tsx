"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import TransitionLink from "./TransitionLink";
import InfoBubble from "./InfoBubble";
import { openCheckout, fetchOffer, CheckoutError, type CheckoutOffer, type Offer } from "../../lib/billing";
import { track } from "../../lib/analytics";
import { OFFERS } from "../../lib/offers";
import { rememberPurchasedOffer, saveCheckoutIntent, takeCheckoutIntent } from "../../lib/supporter-storage";

const COMPARISON: { feature: string; free: string; supporter: string; info?: string }[] = [
  {
    feature: "Auto-sync",
    free: "Reinstall the addon after every change",
    supporter: "The addon updates itself, nothing to do",
  },
  {
    feature: "Auto-log to Diary",
    free: "Click “watched” yourself",
    supporter: "Logged when you finish, dated",
    info: "Works on Stremio Desktop and Web for now.",
  },
  {
    feature: "Persistent session",
    free: "Log in again, every time",
    supporter: "You’re already in",
  },
  {
    feature: "Titles in your language",
    free: "English titles and synopses",
    supporter: "Film titles and synopses in your language",
    info: "French, Spanish, Portuguese, Italian, German, Dutch and Turkish, from TMDB. Where no translation exists, English is kept.",
  },
];

const TOAST_DURATION = 4000;

interface ToastItem {
  id: number;
  message: ReactNode;
  tone: "error" | "info";
}

/**
 * The Free / Supporter comparison and the two offers, with the whole checkout
 * flow: offer lookup, Polar overlay, login hand-off (401) and resume after login.
 */
export default function SupporterOffer() {
  const router = useRouter();
  const [opening, setOpening] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastIdRef = useRef(0);
  const [offer, setOffer] = useState<Offer | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchOffer().then((value) => {
      if (!cancelled) setOffer(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const dismissToast = (id: number) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  };

  const showToast = (message: ReactNode, tone: ToastItem["tone"]) => {
    const id = ++toastIdRef.current;
    setToasts((prev) => [...prev, { id, message, tone }]);
    setTimeout(() => dismissToast(id), TOAST_DURATION);
  };

  const subscribe = async (offerKind: CheckoutOffer) => {
    track("pricing_subscribe_clicked", { offer: offerKind });
    setOpening(true);
    try {
      // Same tab, same JS context: /configure's poll picks up the in-memory
      // session and applies the supporter session once Polar confirms.
      await openCheckout(() => {
        rememberPurchasedOffer(offerKind);
        router.push("/configure?checkout=success");
      }, offerKind);
    } catch (err) {
      const notLoggedIn = err instanceof CheckoutError && err.status === 401;
      const soldOut = err instanceof CheckoutError && err.status === 410;
      track("checkout_failed", { reason: notLoggedIn ? "not_logged_in" : soldOut ? "sold_out" : "error" });
      if (soldOut) {
        showToast("All Founder seats are gone. The yearly plan is still here.", "info");
        setOffer((current) => (current ? { ...current, founderAvailable: false } : { founderAvailable: false }));
      } else if (notLoggedIn) {
        saveCheckoutIntent(offerKind);
        showToast(
          <>
            You&apos;re not logged in.{" "}
            <TransitionLink
              href="/configure"
              className="text-foreground underline underline-offset-2 hover:text-muted"
            >
              Log in
            </TransitionLink>{" "}
            with your Letterboxd password and you&apos;ll come back here automatically.
          </>,
          "info"
        );
      } else {
        showToast("Couldn't open the checkout right now. Try again in a moment.", "error");
      }
    } finally {
      setOpening(false);
    }
  };

  // Back from /configure after a login that a 401 asked for: reopen the
  // checkout the user had picked, once. The ref guards the dev double-mount.
  const resumedRef = useRef(false);
  useEffect(() => {
    if (resumedRef.current) return;
    resumedRef.current = true;
    if (new URLSearchParams(window.location.search).get("resume") !== "1") return;
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.hash}`);
    const intent = takeCheckoutIntent();
    // Deferred: subscribe() sets state, which must not happen synchronously inside an effect.
    if (intent) window.setTimeout(() => void subscribe(intent), 0);
    // Mount-only: resuming again on a re-render would reopen the checkout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const founderGone = offer?.founderAvailable === false;

  return (
    <div className="grid gap-8 lg:gap-10">
      <div>
        <h2 className="text-[28px] font-medium leading-[1.08] tracking-[-0.035em] text-foreground sm:text-[40px]">
          Support <span translate="no">Stremboxd</span>.
        </h2>
        <p className="mt-3 text-[16px] leading-relaxed text-muted md:whitespace-nowrap">
          Supporting pays the hosting and adds features that run without you.
        </p>
      </div>

      <div aria-live="polite" className="grid gap-4 sm:grid-cols-2">
        <PlanCard
          name="Supporter"
          price={OFFERS.supporter.price}
          period={OFFERS.supporter.period}
          detail={OFFERS.supporter.detail}
          cta={opening ? "Opening checkout\u2026" : "Become a Supporter"}
          disabled={opening}
          onClick={() => subscribe("supporter")}
        />
        <PlanCard
          name="Founder"
          price={OFFERS.founder.price}
          period={OFFERS.founder.period}
          detail={OFFERS.founder.detail}
          info="Founder access lasts as long as Stremboxd runs, which depends on Letterboxd and Stremio."
          cta={founderGone ? "No longer available" : opening ? "Opening checkout\u2026" : "Become a Founder"}
          disabled={opening || founderGone}
          onClick={() => subscribe("founder")}
        />
      </div>

      <div>
        <h3 className="sr-only">Free compared to Supporter</h3>
        <div
          className="hidden grid-cols-3 gap-x-6 border-b border-line pb-3 font-mono text-xs text-dim sm:grid"
          aria-hidden="true"
        >
          <span>Feature</span>
          <span>Free</span>
          <span className="text-foreground">Supporter</span>
        </div>
        <ul>
          {COMPARISON.map((row) => (
            <li
              key={row.feature}
              className="grid grid-cols-1 gap-2 border-b border-line py-4 sm:grid-cols-3 sm:items-center sm:gap-x-6"
            >
              <InfoBubble info={row.info}>
                <h4 className="text-[16px] font-medium text-foreground">{row.feature}</h4>
              </InfoBubble>
              <p className="flex gap-3 text-sm text-dim sm:block">
                <span className="w-[72px] shrink-0 font-mono text-[12px] sm:hidden">Free</span>
                <span>{row.free}</span>
              </p>
              <p className="flex gap-3 text-sm text-foreground sm:block">
                <span className="w-[72px] shrink-0 font-mono text-[12px] text-dim sm:hidden">Supporter</span>
                <span>{row.supporter}</span>
              </p>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-dim">More supporter features are on the way, included at no extra cost.</p>
      </div>

      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

function PlanCard({
  name,
  price,
  period,
  detail,
  info,
  cta,
  disabled,
  onClick,
}: {
  name: string;
  price: string;
  period: string;
  detail: string;
  info?: string;
  cta: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <div className="surface flex min-w-0 flex-col gap-6 p-5 sm:p-7">
      <div className="flex min-w-0 flex-col gap-2">
        <h3 className="text-[18px] font-medium text-foreground">{name}</h3>
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-[28px] font-medium leading-none tracking-[-0.04em] tabular-nums">{price}</span>
          <span className="text-sm text-dim">{period}</span>
        </p>
        <InfoBubble info={info}>
          <p className="min-w-0 text-[14px] text-dim">{detail}</p>
        </InfoBubble>
      </div>
      <button type="button" onClick={onClick} disabled={disabled} className="btn btn-primary mt-auto w-full">
        {cta}
      </button>
    </div>
  );
}

function ToastStack({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: number) => void }) {
  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-4 top-4 z-[90] flex flex-col gap-2.5 sm:left-auto sm:right-6 sm:top-6 sm:w-[360px]">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="status"
          className="pointer-events-auto animate-fade-in relative overflow-hidden rounded-card border border-line-strong bg-background px-4 py-3.5 shadow-2xl"
        >
          <span
            className={`absolute inset-y-0 left-0 w-0.5 ${toast.tone === "info" ? "bg-amber-500/80" : "bg-red-500/80"}`}
          />
          <div className="min-w-0 flex-1 pl-2 pr-8">
            <p className="font-mono text-[12px] text-dim">{toast.tone === "info" ? "Heads up" : "Error"}</p>
            <p className="mt-1 text-sm leading-relaxed text-foreground">{toast.message}</p>
          </div>
          <button
            type="button"
            onClick={() => onDismiss(toast.id)}
            className="absolute right-1.5 top-1.5 flex h-9 w-9 items-center justify-center text-dim transition-colors hover:text-foreground"
            aria-label="Dismiss notification"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}
