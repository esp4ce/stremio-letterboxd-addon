"use client";

import { useEffect, useId, useRef, useState, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import TransitionLink from "../components/TransitionLink";
import Footer from "../components/Footer";
import { openCheckout, fetchOffer, CheckoutError, type CheckoutOffer, type Offer } from "../../lib/billing";
import { track } from "../../lib/analytics";
import { rememberPurchasedOffer, saveCheckoutIntent, takeCheckoutIntent } from "../../lib/supporter-storage";

const COMPARISON: { feature: string; free: string; supporter: string; info?: string }[] = [
  {
    feature: "Auto-sync",
    free: "Reinstall the addon after every change",
    supporter: "The addon updates itself, nothing to do",
  },
  {
    feature: "Auto-log to Diary",
    free: "Click \"watched\" yourself",
    supporter: "Logged when you finish, dated",
    info: "Works on Stremio Desktop and Web for now.",
  },
  {
    feature: "Persistent session",
    free: "Log in again, every time",
    supporter: "You're already in",
  },
];

const TOAST_DURATION = 4000;

interface ToastItem {
  id: number;
  message: ReactNode;
  tone: "error" | "info";
}

export default function PricingPage() {
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

  // Send Back to wherever the user came from, not a hardcoded page.
  // document.referrer doesn't work here since TransitionLink navigates via
  // router.push — history length is the only reliable signal we have.
  const goBack = (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    document.documentElement.dataset.transition = "down";

    const navigate = () => {
      if (window.history.length > 1) {
        router.back();
      } else {
        router.push("/");
      }
    };

    if (document.startViewTransition) {
      document.startViewTransition(navigate);
    } else {
      navigate();
    }
  };

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
        setOffer((current) => (current ? { ...current, founderAvailable: false } : current));
      } else if (notLoggedIn) {
        saveCheckoutIntent(offerKind);
        showToast(
          <>
            You&apos;re not logged in.{" "}
            <TransitionLink
              href="/configure"
              direction="down"
              className="text-white underline underline-offset-2 hover:text-zinc-300"
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
    window.history.replaceState(null, "", window.location.pathname);
    const intent = takeCheckoutIntent();
    if (intent) void subscribe(intent);
    // Mount-only: resuming again on a re-render would reopen the checkout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 overflow-y-auto bg-[#0a0a0a] text-white">
      <Link
        href="/"
        onClick={goBack}
        className="absolute left-4 top-4 z-10 text-sm font-light text-zinc-500 transition-colors hover:text-zinc-200 sm:left-6 sm:top-6"
      >
        <svg className="mr-1 -mt-0.5 inline-block h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back
      </Link>

      <div className="flex min-h-full flex-col">
      <div className="mx-auto flex w-full max-w-[980px] flex-1 flex-col justify-center gap-10 px-5 pb-8 pt-16 sm:gap-12 sm:px-10 sm:py-16">
        <section>
          <h1 className="text-2xl font-semibold leading-tight tracking-tight sm:text-4xl">
            Support Stremboxd.
          </h1>
          <p className="mt-3 text-base font-light leading-relaxed text-zinc-400 lg:whitespace-nowrap sm:text-lg">
            Everything else in Stremboxd stays free and open source. Supporting pays the hosting.
          </p>
        </section>

        <section aria-labelledby="compare-heading">
          <h2 id="compare-heading" className="sr-only">
            Free compared to supporter
          </h2>
          <div className="hidden grid-cols-[150px_1fr_1fr] gap-x-6 lg:grid-cols-[200px_1fr_1fr] lg:gap-x-8 border-b border-zinc-800 pb-3 text-xs text-zinc-500 sm:grid">
            <span>Feature</span>
            <span>Free</span>
            <span className="text-white">Supporter</span>
          </div>
          <div>
            {COMPARISON.map((row, index) => (
              <FeatureRow key={row.feature} row={row} first={index === 0} />
            ))}
          </div>
          <p className="mt-4 text-sm font-light text-zinc-400">
            More supporter features are on the way, included at no extra cost.
          </p>
        </section>

        <section aria-live="polite" className="flex flex-col gap-3">
          <div className={`grid gap-3 ${offer?.founderAvailable ? "sm:grid-cols-2" : ""}`}>
            <PlanCard
              price={"9,99 €"}
              period="/ year"
              detail={"or 3 € / month"}
              cta={opening ? "Opening checkout..." : "Become a supporter"}
              disabled={opening}
              onClick={() => subscribe("supporter")}
            />
            {offer?.founderAvailable && (
              <PlanCard
                price={"49 €"}
                period="once"
                detail="Lifetime access · Limited to 20 seats"
                info="Founder access lasts as long as Stremboxd runs, which depends on Letterboxd and Stremio."
                cta="Become a Founder"
                disabled={opening}
                onClick={() => subscribe("founder")}
              />
            )}
          </div>
        </section>

        <p className="text-center text-sm font-light text-zinc-500">
          Questions about billing or cancelling? Answers in the{" "}
          <TransitionLink
            href="/faq"
            direction="up"
            className="text-zinc-400 underline decoration-zinc-700 underline-offset-2 transition-colors hover:text-zinc-200"
          >
            FAQ
          </TransitionLink>
          , under Supporter.
        </p>
      </div>

      <Footer absolute={false} />
      </div>

      <ToastStack toasts={toasts} onDismiss={dismissToast} />
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
          className="pointer-events-auto animate-fade-in relative overflow-hidden rounded-xl border border-zinc-700/80 bg-black/95 px-4 py-3.5 shadow-2xl"
        >
          <span
            className={`absolute inset-y-0 left-0 w-0.5 ${toast.tone === "info" ? "bg-amber-500/80" : "bg-red-500/80"}`}
          />
          <div className="min-w-0 flex-1 pl-2 pr-8">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
              {toast.tone === "info" ? "Heads up" : "Error"}
            </p>
            <p className="mt-1 text-sm leading-relaxed text-zinc-100">{toast.message}</p>
          </div>
          <button
            type="button"
            onClick={() => onDismiss(toast.id)}
            className="absolute right-2.5 top-2.5 text-zinc-500 transition-colors hover:text-zinc-200"
            aria-label="Dismiss notification"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}

function FeatureRow({ row, first }: { row: (typeof COMPARISON)[number]; first: boolean }) {
  return (
    <div
      className={`grid grid-cols-1 gap-2.5 py-5 sm:grid-cols-[150px_1fr_1fr] sm:items-center sm:gap-x-6 lg:grid-cols-[200px_1fr_1fr] lg:gap-x-8 sm:gap-y-0 sm:border-b sm:border-zinc-900 sm:py-6 ${
        first ? "" : "border-t border-zinc-900 sm:border-t-0"
      }`}
    >
      <InfoLabel info={row.info}>
        <h3 className="text-base font-medium text-zinc-200">{row.feature}</h3>
      </InfoLabel>

      <div className="flex items-start gap-3 text-sm font-light text-zinc-500 sm:block lg:whitespace-nowrap">
        <span className="w-20 shrink-0 text-xs text-zinc-600 sm:hidden">Free</span>
        <span>{row.free}</span>
      </div>

      <div className="flex items-start gap-3 text-sm font-medium text-white sm:flex sm:items-center sm:gap-1.5 lg:whitespace-nowrap">
        <span className="w-20 shrink-0 text-xs font-light text-zinc-600 sm:hidden">Supporter</span>
        <svg className="hidden h-3.5 w-3.5 shrink-0 text-zinc-400 sm:block" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
        </svg>
        <span>{row.supporter}</span>
      </div>
    </div>
  );
}

function PlanCard({
  price,
  period,
  detail,
  info,
  cta,
  disabled,
  onClick,
}: {
  price: string;
  period: string;
  detail: string;
  /** Optional fine print, opened from a small "i" button (tap-friendly, unlike a title tooltip). */
  info?: string;
  cta: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <div className="film-grain relative flex min-w-0 flex-col gap-5 overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/60 px-5 py-6 sm:px-7 sm:py-7">
      <div className="flex min-w-0 flex-col gap-1">
        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-3xl font-semibold tracking-tight">{price}</span>
          <span className="text-sm font-light text-zinc-400">{period}</span>
        </p>
        <InfoLabel info={info}>
          <p className="min-w-0 text-xs font-light text-zinc-500">{detail}</p>
        </InfoLabel>
      </div>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="mt-auto flex items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-white px-5 py-3 text-sm font-semibold text-black transition-colors hover:bg-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900 disabled:cursor-not-allowed disabled:opacity-50 sm:py-2.5"
      >
        {cta}
      </button>
    </div>
  );
}

/**
 * A label with an optional small "i" button. The fine print opens inline under the label
 * (tap-friendly, unlike a title tooltip, and never clipped by a card or the screen edge);
 * tapping anywhere else or pressing Escape closes it.
 */
function InfoLabel({ info, children }: { info?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePress = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePress);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePress);
  }, [open]);

  if (!info) return <>{children}</>;

  return (
    <div ref={ref} className="min-w-0">
      <div className="flex items-center gap-1.5">
        {children}
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
          }}
          aria-expanded={open}
          aria-controls={id}
          aria-label="More information"
          className={`-m-2 flex flex-shrink-0 cursor-help items-center justify-center rounded-full p-2 transition-colors hover:text-zinc-300 focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500 ${open ? "text-zinc-300" : "text-zinc-600"}`}
        >
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="9" strokeWidth={2} />
            <path d="M12 16v-4.5M12 8h.01" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      <p
        id={id}
        role="status"
        hidden={!open}
        className="mt-2 max-w-xs rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-[11px] font-light leading-relaxed text-zinc-300"
      >
        {info}
      </p>
    </div>
  );
}
