"use client";

import { Suspense, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import TransitionLink from "../components/TransitionLink";
import Footer from "../components/Footer";
import SiteHeader from "../components/SiteHeader";
import { OtpInput } from "./components/OtpInput";
import { ConfigureSteps } from "./components/ConfigureSteps";
import ConfigurationModal from "./ConfigurationModal";
import { Toggle } from "./components/primitives";
import type { UserPreferences } from "../../types/preferences";
import { readAuthKey, syncAddon, type SyncResult } from "../../lib/stremio-sync";
import { readSession as readNuvioSession, syncAddon as syncNuvioAddon } from "../../lib/nuvio-sync";
import { track } from "../../lib/analytics";
import { authHeaders, getInMemorySessionToken, setInMemorySessionToken } from "../../lib/session-token";
import { sendSupporterReason, type CheckoutOffer, type SupporterReason } from "../../lib/billing";
import { browserTimeZone, withNativeSync } from "../../lib/native-sync";
import { clearPurchasedOffer, peekCheckoutIntent, readPurchasedOffer } from "../../lib/supporter-storage";

const TOAST_DURATION = 3000;
// Subscriptions usually confirm within seconds; a Founder grant can land slower.
const CHECKOUT_POLL_DEADLINE_MS: Record<CheckoutOffer, number> = { supporter: 20_000, founder: 60_000 };

const SUPPORTER_REASONS: Array<{ value: SupporterReason; label: string }> = [
  { value: "auto_log", label: "Auto-log to Diary" },
  { value: "auto_sync", label: "Auto-sync" },
  { value: "stay_signed_in", label: "Staying signed in" },
  { value: "support_project", label: "Supporting the project" },
  { value: "other", label: "Something else" },
];
const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";

interface LoginResponse {
  manifestUrl: string;
  user: {
    id: string;
    username: string;
    displayName: string | null;
  };
  lists: Array<{
    id: string;
    name: string;
    filmCount: number;
    description?: string;
  }>;
  preferences: UserPreferences | null;
  entitled: boolean;
  userToken?: string;
}

interface LoginError {
  error: string;
  code?: string;
}

interface UsernameValidation {
  username: string;
  displayName: string;
  memberId: string;
  lists: Array<{ id: string; name: string; filmCount: number }>;
}

interface PublicConfig {
  u?: string;
  c: { watchlist?: boolean; popular: boolean; top250: boolean; likedFilms?: boolean };
  l: string[];
  r: boolean;
  n?: Record<string, string>;
  w?: string[];
  o?: string[];
  s?: Record<string, string[]>;
  f?: Array<{ t: 'd' | 'a' | 's'; id: string }>;
  h?: boolean;
  nh?: boolean;
  q?: boolean;
}

interface ToastItem {
  id: number;
  message: ReactNode;
  tone: "error" | "upsell" | "success";
}

interface ResolvedList {
  id: string;
  name: string;
  owner: string;
  filmCount: number;
}

interface ResolvedContributor {
  id: string;
  name: string;
  kind: 'director' | 'actor' | 'studio';
  type: string;
}

const CONTRIBUTOR_URL_RE = /letterboxd\.com\/(director|actor|studio)\//i;

const PUBLIC_DRAFT_STORAGE_KEY = "configure:public-draft";
// Guards decoding against an oversized ?c= payload before any JSON parsing.
const PUBLIC_DRAFT_MAX_LENGTH = 16_384;

/**
 * Snapshot of the public configurator state, distinct from PublicConfig
 * (which only carries list ids — not enough to redraw the UI). Own lists are
 * left out and re-fetched on restore to keep the URL short.
 */
interface PublicDraft {
  v: 1;
  user?: Omit<UsernameValidation, "lists">;
  catalogs: { popular: boolean; top250: boolean };
  watchlist: boolean;
  ownLists: string[];
  likedFilms: boolean;
  lists: ResolvedList[];
  contributors: ResolvedContributor[];
  externalWatchlists: Array<{ username: string; displayName: string }>;
  showRatings: boolean;
  hideUnreleased: boolean;
  hideNoHomeRelease: boolean;
  search: boolean;
  catalogNames: Record<string, string>;
  catalogOrder: string[];
  sortVariants: Record<string, string[]>;
}

function getDefaultPreferences(
  lists: LoginResponse["lists"]
): UserPreferences {
  return {
    catalogs: { watchlist: true, diary: true, friends: true, popular: false, top250: true, likedFilms: false, recommended: true },
    ownLists: lists.map((l) => l.id),
    externalLists: [],
  };
}

function encodeBase64Url(value: unknown): string {
  const utf8Bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  for (const byte of utf8Bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function decodeBase64Url(raw: string): unknown {
  const base64 = raw.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

function encodePublicConfig(config: PublicConfig): string {
  return encodeBase64Url(config);
}

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

const isRecordOf = <T,>(value: unknown, isValid: (item: unknown) => item is T): value is Record<string, T> =>
  typeof value === "object" && value !== null && !Array.isArray(value) &&
  Object.values(value).every(isValid);

/**
 * Parses a resume link payload. Anything unexpected yields null so a malformed
 * or tampered ?c= value falls back to the normal form instead of half-applying.
 */
function parsePublicDraft(raw: string): PublicDraft | null {
  if (raw.length === 0 || raw.length > PUBLIC_DRAFT_MAX_LENGTH) return null;

  let decoded: unknown;
  try {
    decoded = decodeBase64Url(raw);
  } catch {
    return null;
  }

  if (typeof decoded !== "object" || decoded === null) return null;
  const draft = decoded as Record<string, unknown>;
  if (draft.v !== 1) return null;

  const catalogs = draft.catalogs as Record<string, unknown> | undefined;
  if (
    typeof catalogs !== "object" || catalogs === null ||
    typeof catalogs.popular !== "boolean" || typeof catalogs.top250 !== "boolean"
  ) {
    return null;
  }

  const booleans = ["watchlist", "likedFilms", "showRatings", "hideUnreleased", "hideNoHomeRelease", "search"];
  if (booleans.some((key) => typeof draft[key] !== "boolean")) return null;

  if (!isStringArray(draft.ownLists) || !isStringArray(draft.catalogOrder)) return null;
  if (!Array.isArray(draft.lists) || !Array.isArray(draft.contributors) || !Array.isArray(draft.externalWatchlists)) {
    return null;
  }
  if (!isRecordOf(draft.catalogNames, (v): v is string => typeof v === "string")) return null;
  if (!isRecordOf(draft.sortVariants, isStringArray)) return null;

  return draft as unknown as PublicDraft;
}

/** Page frame for every /configure screen: wordmark, a way back, a centred column, the shared footer. */
function Frame({
  children,
  width = "max-w-[1600px]",
  step,
}: {
  children: ReactNode;
  width?: string;
  step?: 1 | 2 | 3;
}) {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      {step && <ConfigureSteps current={step} />}
      <main id="main" className={`mx-auto flex w-full ${width} flex-1 flex-col justify-center px-4 py-6 sm:px-6 lg:px-8`}>{children}</main>
      <Footer />
    </div>
  );
}

export default function Configure() {
  return (
    <Suspense
      fallback={
        <Frame step={1}>
          <h1 className="sr-only">Connect your Letterboxd account to Stremio and Nuvio</h1>
          <div className="min-h-[420px]" aria-busy="true" />
        </Frame>
      }
    >
      <ConfigureInner />
    </Suspense>
  );
}

// useSearchParams() requires a Suspense boundary above it for the static
// shell — the actual read never suspends at runtime, this is build-time only.
const PASSWORD_NOTE = "Used once to sign in. We keep an encrypted token, never your password.";
const PASSWORD_NOTE_SHORT = "Used once to sign in, never stored.";

function subscribeToWidth(onChange: () => void) {
  const query = window.matchMedia("(min-width: 640px)");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function ConfigureInner() {
  // The full sentence needs about 440px; below that, a shorter wording keeps the placeholder on one line.
  const wide = useSyncExternalStore(
    subscribeToWidth,
    () => window.matchMedia("(min-width: 640px)").matches,
    () => true
  );
  const searchParams = useSearchParams();
  const router = useRouter();
  const [confirmingCheckout, setConfirmingCheckout] = useState(searchParams.get("checkout") === "success");
  const [checkoutNeedsLogin, setCheckoutNeedsLogin] = useState(false);
  // Founder poll ran out: payment went through, the grant is just slow.
  const [checkoutSlow, setCheckoutSlow] = useState(false);
  // Set once the poll confirms entitlement: shows the one-time thank-you screen.
  const [checkoutWelcome, setCheckoutWelcome] = useState<CheckoutOffer | null>(null);
  const [autoLogState, setAutoLogState] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [reasonAnswered, setReasonAnswered] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [copied, setCopied] = useState(false);
  const [forceMainForm, setForceMainForm] = useState(false);

  // Full auth state
  const [result, setResult] = useState<LoginResponse | null>(null);
  const [showConfig, setShowConfig] = useState(false);
  const [preferences, setPreferences] = useState<UserPreferences | null>(null);
  const [isSavingPrefs, setIsSavingPrefs] = useState(false);
  const [isStremioLinked, setIsStremioLinked] = useState(false);
  const [isNuvioLinked, setIsNuvioLinked] = useState(false);
  const [syncOutcome, setSyncOutcome] = useState<SyncResult | null>(null);
  const [entitled, setEntitled] = useState(false);

  // Public (username-only) state
  const [usernameValidated, setUsernameValidated] = useState<UsernameValidation | null>(null);
  const [showPublicConfig, setShowPublicConfig] = useState(false);
  const [publicCatalogs, setPublicCatalogs] = useState({ popular: true, top250: true });
  const [publicWatchlist, setPublicWatchlist] = useState(true);
  const [publicOwnLists, setPublicOwnLists] = useState<string[]>([]);
  const [publicLikedFilms, setPublicLikedFilms] = useState(false);
  const [publicLists, setPublicLists] = useState<Array<{ id: string; name: string; owner: string; filmCount: number }>>([]);
  const [publicContributors, setPublicContributors] = useState<ResolvedContributor[]>([]);
  const [publicExternalWatchlists, setPublicExternalWatchlists] = useState<Array<{ username: string; displayName: string }>>([]);
  const [showRatings, setShowRatings] = useState(true);
  const [hideUnreleased, setHideUnreleased] = useState(false);
  const [hideNoHomeRelease, setHideNoHomeRelease] = useState(false);
  const [publicSearch, setPublicSearch] = useState(true);
  const [publicCatalogNames, setPublicCatalogNames] = useState<Record<string, string>>({});
  const [publicCatalogOrder, setPublicCatalogOrder] = useState<string[]>([]);
  const [publicSortVariants, setPublicSortVariants] = useState<Record<string, string[]>>({});
  const [generatedManifestUrl, setGeneratedManifestUrl] = useState<string | null>(null);
  const [resumeLink, setResumeLink] = useState<string | null>(null);
  const [resumeCopied, setResumeCopied] = useState(false);

  // Shared
  const [externalListUrl, setExternalListUrl] = useState("");
  const [isResolvingList, setIsResolvingList] = useState(false);

  // 2FA state
  const [show2FA, setShow2FA] = useState(false);
  const [totpCode, setTotpCode] = useState("");
  const [is2FALoading, setIs2FALoading] = useState(false);

  // Stays true until the stored session (cookie) and resume link have been
  // checked, so the login form never flashes for a returning user.
  const [isRestoringSession, setIsRestoringSession] = useState(true);

  const usernameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  // The 2FA step replaces the form, so the typed credentials are kept here for the second request.
  const credentialsRef = useRef<{ username: string; password: string }>({ username: "", password: "" });
  // Bumped after a rejected code so the digit fields come back empty and focused.
  const [otpKey, setOtpKey] = useState(0);
  const toastIdRef = useRef(0);
  const [passwordPreview, setPasswordPreview] = useState("");
  const hasPassword = passwordPreview.trim().length > 0;
  // Default on: matches the pre-existing always-persist behavior for
  // supporters. Has no effect for non-supporters (no cookie either way).
  const [rememberMe, setRememberMe] = useState(true);
  // Explicit choice between the two ways to use the addon; the password field only exists in full access.
  const [fullAccess, setFullAccess] = useState(true);
  const [showPassword, setShowPassword] = useState(false);

  const dismissToast = (id: number) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  };

  const showErrorToast = (message: string) => {
    const id = ++toastIdRef.current;
    setToasts((prev) => [...prev, { id, message, tone: "error" }]);
    setTimeout(() => dismissToast(id), TOAST_DURATION);
  };

  const showUpsellToast = (message: ReactNode, durationMs = TOAST_DURATION) => {
    const id = ++toastIdRef.current;
    const withLink = (
      <>
        {message}{" "}
        <TransitionLink
          href="/#supporter"
          className="whitespace-nowrap text-muted underline decoration-line-strong underline-offset-2 transition-colors hover:text-foreground"
        >
          See supporter plan →
        </TransitionLink>
      </>
    );
    setToasts((prev) => [...prev, { id, message: withLink, tone: "upsell" }]);
    setTimeout(() => dismissToast(id), durationMs);
  };


  const formatListResolveError = (message: string) => {
    const normalized = message.replace(/\s+/g, " ").trim();
    const cleaned = normalized
      .replace(/\s*expected format:.*$/i, "")
      .replace(/\s*format attendu:.*$/i, "")
      .trim();

    if (cleaned.length === 0) return "Invalid list URL.";
    return cleaned;
  };

  const showListResolveErrorToast = (error: unknown) => {
    const rawMessage = error instanceof Error ? error.message : "Failed to resolve list";
    showErrorToast(formatListResolveError(rawMessage));
  };

  const resetSessionResults = () => {
    setResult(null);
    setPreferences(null);
    setUsernameValidated(null);
    setGeneratedManifestUrl(null);
    setResumeLink(null);
    setResumeCopied(false);
    setShowConfig(false);
    setShowPublicConfig(false);
    setShow2FA(false);
    setTotpCode("");
    setPublicLists([]);
    setPublicContributors([]);
    setPublicExternalWatchlists([]);
    setPublicCatalogs({ popular: true, top250: true });
    setPublicWatchlist(true);
    setPublicOwnLists([]);
    setPublicLikedFilms(false);
    setShowRatings(true);
    setPublicCatalogNames({});
    setPublicCatalogOrder([]);
    setPublicSortVariants({});
  };

  const returnToMainForm = () => {
    setShowConfig(false);
    setShowPublicConfig(false);
    setForceMainForm(true);
  };

  const resolveList = async (
    endpoint: "/letterboxd/resolve-list" | "/auth/resolve-list-public",
    body: Record<string, string>
  ): Promise<ResolvedList> => {
    const response = await fetch(`${BACKEND_URL}${endpoint}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (!response.ok) {
      const rawError = typeof data?.error === "string" ? data.error : "Failed to resolve list";
      throw new Error(formatListResolveError(rawError));
    }

    return data as ResolvedList;
  };

  // A render helper, not a component: a component declared here would be a new type on every render.
  const renderErrorToastStack = () => {
    if (toasts.length === 0) return null;

    return (
      <div className="pointer-events-none fixed inset-x-4 top-4 z-[90] flex flex-col gap-2.5 sm:left-auto sm:right-6 sm:top-6 sm:w-[360px]">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="pointer-events-auto animate-fade-in relative overflow-hidden rounded-card border border-line-strong bg-background px-4 py-3.5 shadow-2xl"
          >
            <span
              className={`absolute inset-y-0 left-0 w-0.5 ${
                toast.tone === "upsell"
                  ? "bg-amber-500/80"
                  : toast.tone === "success"
                    ? "bg-emerald-500/80"
                    : "bg-red-500/80"
              }`}
            />
            <div className="min-w-0 flex-1 pl-2 pr-8">
              <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-dim">
                {toast.tone === "upsell" ? "Heads up" : toast.tone === "success" ? "Success" : "Error"}
              </p>
              <p className="mt-1 text-sm leading-relaxed text-foreground">{toast.message}</p>
            </div>
            <button
              type="button"
              onClick={() => dismissToast(toast.id)}
              className="absolute right-2.5 top-2.5 text-dim transition-colors hover:text-foreground"
              aria-label="Dismiss error notification"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    );
  };

  const applyLoginResult = (loginResult: LoginResponse, warnIfRememberMeIneffective = false) => {
    setInMemorySessionToken(
      "userToken" in loginResult && typeof loginResult.userToken === "string" ? loginResult.userToken : null
    );
    setEntitled(loginResult.entitled);
    if (warnIfRememberMeIneffective && rememberMe && !loginResult.entitled) {
      showUpsellToast("Stay signed in needs a supporter subscription.", 6000);
    }
    setResult(loginResult);
    const defaults = getDefaultPreferences(loginResult.lists);
    const prefs = loginResult.preferences
      ? { ...loginResult.preferences, catalogs: { ...defaults.catalogs, ...loginResult.preferences.catalogs } }
      : defaults;
    setPreferences(prefs);
    setShowConfig(true);
  };

  const fetchMemberLists = async (username: string): Promise<UsernameValidation["lists"]> => {
    try {
      const response = await fetch(`${BACKEND_URL}/auth/validate-username`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ username }),
      });
      const data = await response.json();
      if (!response.ok || !data.valid) return [];
      return data.lists as UsernameValidation["lists"];
    } catch {
      return [];
    }
  };

  const applyPublicDraft = async (draft: PublicDraft) => {
    if (draft.user) {
      // Own lists are not carried by the draft: re-resolve them by username.
      const lists = await fetchMemberLists(draft.user.username);
      setUsernameValidated({ ...draft.user, lists });
    } else {
      setUsernameValidated(null);
    }
    setPublicCatalogs(draft.catalogs);
    setPublicWatchlist(draft.watchlist);
    setPublicOwnLists(draft.ownLists);
    setPublicLikedFilms(draft.likedFilms);
    setPublicLists(draft.lists);
    setPublicContributors(draft.contributors);
    setPublicExternalWatchlists(draft.externalWatchlists);
    setShowRatings(draft.showRatings);
    setHideUnreleased(draft.hideUnreleased);
    setHideNoHomeRelease(draft.hideNoHomeRelease);
    setPublicSearch(draft.search);
    setPublicCatalogNames(draft.catalogNames);
    setPublicCatalogOrder(draft.catalogOrder);
    setPublicSortVariants(draft.sortVariants);
    setShowPublicConfig(true);
  };

  // Restores a returning user: the httpOnly session cookie for the full mode,
  // a ?c= resume link or the last local draft for the public mode.
  useEffect(() => {
    let cancelled = false;

    const restore = async () => {
      const resumeParam = new URLSearchParams(window.location.search).get("c");

      // An explicit resume link always wins: the user followed it on purpose.
      const resumeDraft = parsePublicDraft(resumeParam ?? "");
      if (resumeDraft) {
        await applyPublicDraft(resumeDraft);
        if (!cancelled) setIsRestoringSession(false);
        return;
      }

      // A real session takes priority over a stale local draft: without this,
      // a supporter who once used the public flow (draft written) then later
      // logged in for real would keep landing back in the public flow forever.
      try {
        const response = await fetch(`${BACKEND_URL}/auth/session`, {
          credentials: "include",
          headers: authHeaders(),
        });

        if (response.ok && !cancelled) {
          applyLoginResult((await response.json()) as LoginResponse);
          if (!cancelled) setIsRestoringSession(false);
          return;
        }
      } catch {
        // fall through to the local draft
      }

      const stored = (() => {
        try {
          return localStorage.getItem(PUBLIC_DRAFT_STORAGE_KEY);
        } catch {
          return null;
        }
      })();

      const draft = parsePublicDraft(stored ?? "");
      if (draft) {
        await applyPublicDraft(draft);
      }

      if (!cancelled) setIsRestoringSession(false);
    };

    void restore();

    return () => {
      cancelled = true;
    };
    // Mount-only: restoring again on every render would fight the user's edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (confirmingCheckout) track("checkout_returned");
    // Mount-only: one event per landing on ?checkout=success.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // After a checkout (?checkout=success), poll until Polar reports the
  // entitlement (subscription or Founder grant) instead of showing a stale
  // unpaid UI.
  useEffect(() => {
    if (!confirmingCheckout) return;

    let cancelled = false;
    // Peeked, not consumed: a reload mid-poll must still know the offer.
    const boughtOffer = readPurchasedOffer() ?? "supporter";
    const deadline = Date.now() + CHECKOUT_POLL_DEADLINE_MS[boughtOffer];
    // The overlay checkout keeps this JS context (and its in-memory token).
    // A redirect fallback lands in a brand-new one with no token and, for a
    // user who was not a supporter yet, no cookie: the poll can never
    // authenticate. Track whether any session exists and stop early with a
    // "log back in" message instead of spinning for 20s.
    let hasSession = getInMemorySessionToken() !== null;

    const poll = async () => {
      for (;;) {
        let answered = false;
        try {
          const res = await fetch(`${BACKEND_URL}/auth/session?fresh=1`, {
            credentials: "include",
            headers: authHeaders(),
          });
          answered = true;
          if (res.ok) {
            hasSession = true;
            const data = (await res.json()) as LoginResponse;
            if (data.entitled) {
              // Apply the fresh session (same mechanism as the mount-time restore)
              // so the UI reflects the just-confirmed entitlement, not the stale
              // pre-payment snapshot taken when this page first loaded.
              if (!cancelled) {
                applyLoginResult(data);
                track("checkout_confirmed", { entitled: true });
                clearPurchasedOffer();
                // A reload must not replay the thank-you screen.
                window.history.replaceState(null, "", window.location.pathname);
                setCheckoutWelcome(boughtOffer);
                setConfirmingCheckout(false);
              }
              return;
            }
          } else if (res.status === 401 || res.status === 403) {
            // NOT_ENTITLED = signed in, Polar not updated yet: keep polling.
            const body = (await res.json().catch(() => null)) as { code?: string } | null;
            hasSession = body?.code === "NOT_ENTITLED";
          }
        } catch {
          // Transient network error while polling — just retry until the deadline.
        }
        if (cancelled) return;
        if (answered && !hasSession) {
          // Confirmed logged out: further polling cannot succeed.
          setCheckoutNeedsLogin(true);
          return;
        }
        if (Date.now() >= deadline) break;
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      if (cancelled) return;
      // The offer is kept on purpose: a later reload of ?checkout=success polls
      // again with the right deadline and thank-you screen.
      if (boughtOffer === "founder") {
        // Paid, grant still on its way: say so calmly rather than drop the user
        // on an unpaid-looking settings page.
        setCheckoutSlow(true);
      } else {
        setConfirmingCheckout(false);
      }
    };

    void poll();
    return () => {
      cancelled = true;
    };
    // applyLoginResult is recreated every render; re-running the poll for it would restart the deadline.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmingCheckout]);

  const handleSubmit = async () => {
    const username = usernameRef.current?.value?.trim();
    const password = passwordRef.current?.value?.trim();

    if (!username) {
      showErrorToast("Please enter your Letterboxd username");
      return;
    }

    credentialsRef.current = { username, password: password ?? "" };

    if (fullAccess && !password) {
      showErrorToast("Enter your password, or choose Username only");
      return;
    }

    track("configure_mode_chosen", { mode: password ? "full" : "public" });
    setIsLoading(true);
    setForceMainForm(false);
    // Reset prior session results so a failed retry cannot show stale success state.
    resetSessionResults();

    try {
      if (password) {
        // Full auth flow
        const response = await fetch(`${BACKEND_URL}/auth/login`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ username, password, rememberMe }),
        });

        const data = await response.json();

        if (!response.ok) {
          const errorData = data as LoginError;
          if (errorData.code === "2FA_REQUIRED") {
            setShow2FA(true);
            setTotpCode("");
            return;
          }
          throw new Error(errorData.error || "Authentication failed");
        }

        const resuming = peekCheckoutIntent() !== null;
        applyLoginResult(data as LoginResponse, !resuming);
        track("login_succeeded", { method: "password", entitled: (data as LoginResponse).entitled, remember_me: rememberMe });
        if (resuming) router.push("/?resume=1#supporter");
      } else {
        // Public flow (username only)
        const response = await fetch(`${BACKEND_URL}/auth/validate-username`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ username }),
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "Failed to validate username");
        }

        if (!data.valid) {
          showErrorToast("Username not found on Letterboxd");
          return;
        }

        setUsernameValidated({
          username: data.username,
          displayName: data.displayName,
          memberId: data.memberId,
          lists: data.lists,
        });
        setPublicOwnLists(data.lists.map((l: { id: string }) => l.id));
        setShowPublicConfig(true);
      }
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit2FA = async (codeOverride?: string) => {
    const { username, password } = credentialsRef.current;

    const code = (codeOverride ?? totpCode).trim();

    if (!username || !password || !code) return;

    setIs2FALoading(true);
    try {
      const response = await fetch(`${BACKEND_URL}/auth/login`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ username, password, totp: code, rememberMe }),
      });

      const data = await response.json();

      if (!response.ok) {
        const errorData = data as LoginError;
        throw new Error(errorData.error || "Authentication failed");
      }

      setShow2FA(false);
      setTotpCode("");
      const resuming = peekCheckoutIntent() !== null;
      applyLoginResult(data as LoginResponse, !resuming);
      track("login_succeeded", { method: "totp", entitled: (data as LoginResponse).entitled, remember_me: rememberMe });
      // Logged in because /pricing asked for it: send them back to their checkout.
      if (resuming) router.push("/?resume=1#supporter");
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : "Invalid code");
      setTotpCode("");
      setOtpKey((key) => key + 1);
    } finally {
      setIs2FALoading(false);
    }
  };

  const postPreferences = async (prefs: UserPreferences) => {
    const response = await fetch(`${BACKEND_URL}/auth/preferences`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ preferences: prefs }),
    });
    if (!response.ok) throw new Error("Failed to save preferences");
  };

  // Explicit opt-in from the thank-you screen: nothing is enabled without this click.
  const handleEnableAutoLog = async () => {
    if (!preferences) return;
    const next = withNativeSync(preferences, true, browserTimeZone());
    setAutoLogState("saving");
    try {
      await postPreferences(next);
      setPreferences(next);
      setAutoLogState("done");
      track("native_sync_enabled_from_checkout");
    } catch {
      setAutoLogState("error");
    }
  };

  const handleReason = (reason: SupporterReason) => {
    setReasonAnswered(true);
    track("supporter_reason_answered", { reason });
    void sendSupporterReason(reason);
  };

  const handleSavePreferences = async () => {
    if (!result || !preferences) return;

    setIsSavingPrefs(true);
    setSyncOutcome(null);
    try {
      await postPreferences(preferences);

      const authKey = readAuthKey();
      const nuvioSession = readNuvioSession();
      if ((!authKey && !nuvioSession) || !result.manifestUrl) {
        setShowConfig(false);
        return;
      }

      if (!entitled) {
        setSyncOutcome(null);
        setShowConfig(false);
        showUpsellToast(
          "Preferences saved. Auto-sync to Stremio/Nuvio requires a Stremboxd supporter subscription — reinstall the addon manually to pick up changes, or subscribe for automatic sync.",
          6000
        );
        return;
      }

      if (authKey) {
        try {
          const outcome = await syncAddon(authKey, result.manifestUrl);
          if (outcome === "unauthorized") {
            setIsStremioLinked(false);
            showErrorToast("Your Stremio session expired. Link your account again to keep syncing.");
          } else {
            setSyncOutcome(outcome);
          }
        } catch {
          showErrorToast("Preferences saved, but syncing to Stremio failed. Try again later.");
        }
      }

      if (nuvioSession) {
        try {
          if (await syncNuvioAddon(result.manifestUrl) === "unauthorized") {
            setIsNuvioLinked(false);
            showErrorToast("Your Nuvio session expired. Link your account again to keep syncing.");
          }
        } catch {
          showErrorToast("Preferences saved, but syncing to Nuvio failed. Try again later.");
        }
      }

      setShowConfig(false);
    } catch {
      showErrorToast("Failed to save preferences. Please try again.");
    } finally {
      setIsSavingPrefs(false);
    }
  };

  const parseWatchlistUrl = (url: string): string | null => {
    const match = url.match(/letterboxd\.com\/([^/?#]+)\/watchlist\/?$/i);
    return match?.[1] ?? null;
  };

  const resolveWatchlistUsername = async (username: string): Promise<{ username: string; displayName: string } | null> => {
    try {
      const response = await fetch(`${BACKEND_URL}/auth/validate-username`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ username }),
      });
      const data = await response.json();
      if (!response.ok || !data.valid) return null;
      return { username: data.username, displayName: data.displayName };
    } catch {
      return null;
    }
  };

  const resolveExternalUrl = async (options: {
    currentUsername?: string;
    isWatchlistDuplicate: (username: string) => boolean;
    isListDuplicate: (id: string) => boolean;
    fetchList: (url: string) => Promise<ResolvedList>;
    onAddWatchlist: (resolved: { username: string; displayName: string }) => void;
    onAddList: (resolved: ResolvedList) => void;
  }) => {
    if (!externalListUrl.trim()) return;
    setIsResolvingList(true);
    try {
      const url = externalListUrl.trim();
      const watchlistUsername = parseWatchlistUrl(url);

      if (watchlistUsername) {
        if (options.currentUsername?.toLowerCase() === watchlistUsername.toLowerCase()) {
          showErrorToast("You can't add your own watchlist as external");
          return;
        }
        if (options.isWatchlistDuplicate(watchlistUsername)) {
          showErrorToast("This watchlist has already been added");
          return;
        }
        const resolved = await resolveWatchlistUsername(watchlistUsername);
        if (!resolved) {
          showErrorToast("Username not found on Letterboxd");
          return;
        }
        options.onAddWatchlist(resolved);
        setExternalListUrl("");
        return;
      }

      const resolved = await options.fetchList(url);
      if (options.isListDuplicate(resolved.id)) {
        showErrorToast("This list has already been added");
        return;
      }
      options.onAddList(resolved);
      setExternalListUrl("");
    } catch (err) {
      showListResolveErrorToast(err);
    } finally {
      setIsResolvingList(false);
    }
  };

  const handleResolveExternalList = () => {
    if (!result) return;

    const url = externalListUrl.trim();
    if (CONTRIBUTOR_URL_RE.test(url)) {
      setIsResolvingList(true);
      fetch(`${BACKEND_URL}/auth/resolve-contributor-public`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ url }),
      })
        .then(async (r) => {
          const data = await r.json();
          if (!r.ok) throw new Error(typeof data?.error === "string" ? data.error : "Failed to resolve contributor");
          const resolved = data as ResolvedContributor;
          const t = resolved.kind[0] as 'd' | 'a' | 's';
          if (preferences?.contributors?.some((c) => c.t === t && c.id === resolved.id)) {
            showErrorToast("This contributor has already been added");
            return;
          }
          setPreferences((prev) => prev ? { ...prev, contributors: [...(prev.contributors ?? []), { t, id: resolved.id, name: resolved.name }] } : prev);
          setExternalListUrl("");
        })
        .catch((err) => showListResolveErrorToast(err))
        .finally(() => setIsResolvingList(false));
      return;
    }

    resolveExternalUrl({
      currentUsername: result.user.username,
      isWatchlistDuplicate: (u) =>
        preferences?.externalWatchlists?.some((w) => w.username.toLowerCase() === u.toLowerCase()) ?? false,
      isListDuplicate: (id) => preferences?.externalLists.some((l) => l.id === id) ?? false,
      fetchList: (url) => resolveList("/letterboxd/resolve-list", { url }),
      onAddWatchlist: (resolved) => {
        if (preferences) setPreferences({ ...preferences, externalWatchlists: [...(preferences.externalWatchlists ?? []), resolved] });
      },
      onAddList: (resolved) => {
        if (preferences) setPreferences({ ...preferences, externalLists: [...preferences.externalLists, resolved] });
      },
    });
  };

  const handleResolvePublicList = () => {
    const url = externalListUrl.trim();
    if (!url) return;

    if (CONTRIBUTOR_URL_RE.test(url)) {
      setIsResolvingList(true);
      fetch(`${BACKEND_URL}/auth/resolve-contributor-public`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ url }),
      })
        .then(async (r) => {
          const data = await r.json();
          if (!r.ok) throw new Error(typeof data?.error === "string" ? data.error : "Failed to resolve contributor");
          const resolved = data as ResolvedContributor;
          if (publicContributors.some((c) => c.id === resolved.id && c.kind === resolved.kind)) {
            showErrorToast("This contributor has already been added");
            return;
          }
          setPublicContributors((prev) => [...prev, resolved]);
          setExternalListUrl("");
        })
        .catch((err) => showListResolveErrorToast(err))
        .finally(() => setIsResolvingList(false));
      return;
    }

    resolveExternalUrl({
      currentUsername: usernameValidated?.username,
      isWatchlistDuplicate: (u) =>
        publicExternalWatchlists.some((w) => w.username.toLowerCase() === u.toLowerCase()),
      isListDuplicate: (id) => publicLists.some((l) => l.id === id),
      fetchList: (url) => resolveList("/auth/resolve-list-public", { url }),
      onAddWatchlist: (resolved) => setPublicExternalWatchlists((prev) => [...prev, resolved]),
      onAddList: (resolved) => setPublicLists((prev) => [...prev, resolved]),
    });
  };

  const handleInstallPublic = () => {
    const cfg: PublicConfig = {
      c: {
        popular: publicCatalogs.popular,
        top250: publicCatalogs.top250,
      },
      l: publicLists.map((l) => l.id),
      r: showRatings,
    };

    if (publicExternalWatchlists.length > 0) {
      cfg.w = publicExternalWatchlists.map((w) => w.username);
    }

    if (Object.keys(publicCatalogNames).length > 0) {
      cfg.n = publicCatalogNames;
    }

    if (publicCatalogOrder.length > 0) {
      cfg.o = publicCatalogOrder;
    }

    if (Object.keys(publicSortVariants).length > 0) {
      cfg.s = publicSortVariants;
    }

    if (hideUnreleased) {
      cfg.h = true;
    }

    if (hideNoHomeRelease) {
      cfg.nh = true;
    }

    if (!publicSearch) {
      cfg.q = false;
    }

    if (publicContributors.length > 0) {
      cfg.f = publicContributors.map((c) => ({ t: c.kind[0] as 'd' | 'a' | 's', id: c.id }));
    }

    if (usernameValidated) {
      cfg.u = usernameValidated.username;
      cfg.c.watchlist = publicWatchlist;
      cfg.c.likedFilms = publicLikedFilms;
      for (const listId of publicOwnLists) {
        if (!cfg.l.includes(listId)) {
          cfg.l.push(listId);
        }
      }
    }

    const encoded = encodePublicConfig(cfg);
    const manifestUrl = `${BACKEND_URL}/${encoded}/manifest.json`;
    setGeneratedManifestUrl(manifestUrl);
    setShowPublicConfig(false);

    const draft: PublicDraft = {
      v: 1,
      ...(usernameValidated
        ? {
            user: {
              username: usernameValidated.username,
              displayName: usernameValidated.displayName,
              memberId: usernameValidated.memberId,
            },
          }
        : {}),
      catalogs: publicCatalogs,
      watchlist: publicWatchlist,
      ownLists: publicOwnLists,
      likedFilms: publicLikedFilms,
      lists: publicLists,
      contributors: publicContributors,
      externalWatchlists: publicExternalWatchlists,
      showRatings,
      hideUnreleased,
      hideNoHomeRelease,
      search: publicSearch,
      catalogNames: publicCatalogNames,
      catalogOrder: publicCatalogOrder,
      sortVariants: publicSortVariants,
    };

    const encodedDraft = encodeBase64Url(draft);
    setResumeLink(`${window.location.origin}/configure?c=${encodedDraft}`);
    try {
      localStorage.setItem(PUBLIC_DRAFT_STORAGE_KEY, encodedDraft);
    } catch {
      // Private mode or blocked storage: the resume link still works.
    }
  };


  const handleCopy = async () => {
    const url = result?.manifestUrl || generatedManifestUrl;
    if (url) {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleCopyResumeLink = async () => {
    if (!resumeLink) return;
    await navigator.clipboard.writeText(resumeLink);
    setResumeCopied(true);
    setTimeout(() => setResumeCopied(false), 2000);
  };

  const handleInstallStremio = () => {
    track("install_clicked", { mode: result ? "full" : "public", reinstall: syncOutcome === "synced" });
    const url = result?.manifestUrl || generatedManifestUrl;
    if (url) {
      const stremioUrl = `stremio://${url.replace(/^https?:\/\//, "")}`;
      window.location.href = stremioUrl;
    }
  };

  const handleReset = () => {
    setToasts([]);
    setForceMainForm(false);
    resetSessionResults();
    setPasswordPreview("");
    if (passwordRef.current) passwordRef.current.value = "";
    try {
      localStorage.removeItem(PUBLIC_DRAFT_STORAGE_KEY);
    } catch {
      // Nothing to clear when storage is unavailable.
    }
    // Drop the resume link from the address bar so a reload starts clean.
    if (window.location.search) {
      window.history.replaceState(null, "", window.location.pathname);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch(`${BACKEND_URL}/auth/logout`, {
        method: "POST",
        credentials: "include",
        headers: authHeaders(),
      });
    } catch {
      // Best effort: the local state is cleared either way.
    } finally {
      setInMemorySessionToken(null);
    }
    handleReset();
  };

  // Just returned from a checkout: hold here until the supporter entitlement is
  // confirmed (or the deadline passes: 20s, 60s for Founder), then fall through.
  if (confirmingCheckout) {
    return (
      <Frame width="max-w-md">
        <div className="text-center" role="status">
          {checkoutSlow ? (
            <>
              <h1 className="text-[28px] font-medium tracking-[-0.03em]">Payment received.</h1>
              <p className="mt-3 text-[16px] leading-relaxed text-muted">Thanks for supporting Stremboxd.</p>
              <p className="mt-2 text-sm leading-relaxed text-dim">
                Founder access can take a minute to show up. Nothing else to do: reload this page in a little while.
              </p>
              <button type="button" onClick={() => setConfirmingCheckout(false)} className="btn btn-ghost mt-6 w-full">
                Continue for now
              </button>
            </>
          ) : checkoutNeedsLogin ? (
            <>
              <h1 className="text-[28px] font-medium tracking-[-0.03em]">Payment received.</h1>
              <p className="mt-3 text-[16px] leading-relaxed text-muted">Thanks for supporting Stremboxd.</p>
              <p className="mt-2 text-sm leading-relaxed text-dim">
                This tab lost your session during checkout. Log back in to activate your supporter session.
              </p>
              <button type="button" onClick={() => setConfirmingCheckout(false)} className="btn btn-primary mt-6 w-full">
                Log in
              </button>
            </>
          ) : (
            <>
              <h1 className="text-[28px] font-medium tracking-[-0.03em]">Confirming your payment…</h1>
              <p className="mt-3 text-sm leading-relaxed text-dim">
                This can take a minute. If nothing happens, reload this page.
              </p>
            </>
          )}
        </div>
      </Frame>
    );
  }

  // Session restore in flight: hold the frame instead of flashing the login form
  if (isRestoringSession) {
    return (
      <Frame step={1}>
        <h1 className="sr-only">Connect your Letterboxd account to Stremio and Nuvio</h1>
        <div className="min-h-[420px]" aria-busy="true" />
      </Frame>
    );
  }

  // One-time thank-you right after a confirmed checkout. Leaving it drops it for good.
  if (checkoutWelcome && result && preferences) {
    const autoLogAlreadyOn = preferences.nativeSync === true && autoLogState !== "done";
    return (
      <Frame width="max-w-md">
        <div className="surface animate-fade-in p-6 sm:p-8">
          <h1 className="text-[28px] font-medium tracking-[-0.03em]">
            {checkoutWelcome === "founder" ? "You\u2019re a Founder." : "You\u2019re a Supporter."}
          </h1>
          <p className="mt-2 text-[16px] text-muted">Thank you. Your support pays the hosting.</p>

          {!autoLogAlreadyOn && (
            <div className="mt-6">
              {autoLogState === "done" ? (
                <p className="rounded-control border border-line px-4 py-3 text-sm text-muted" role="status">
                  Auto-log to Diary is on.
                </p>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={handleEnableAutoLog}
                    disabled={autoLogState === "saving"}
                    className="btn btn-primary w-full"
                  >
                    {autoLogState === "saving" ? "Turning on…" : "Turn on Auto-log to Diary"}
                  </button>
                  <p className="mt-2 text-[14px] text-dim">
                    {autoLogState === "error"
                      ? "Couldn\u2019t turn it on right now. Try again, or later from your settings."
                      : "Films you finish in Stremio land in your diary, dated."}
                  </p>
                </>
              )}
            </div>
          )}

          <div className="mt-6 border-t border-line pt-5">
            {reasonAnswered ? (
              <p className="text-sm text-muted">Thanks.</p>
            ) : (
              <>
                <p className="text-sm text-muted">
                  What made you decide? <span className="text-dim">(optional)</span>
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {SUPPORTER_REASONS.map((reason) => (
                    <button
                      key={reason.value}
                      type="button"
                      onClick={() => handleReason(reason.value)}
                      className="rounded-control border border-line-strong px-3 py-2 text-[14px] text-muted transition-colors hover:border-control hover:text-foreground"
                    >
                      {reason.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {checkoutWelcome === "founder" && (
            <p className="mt-4 text-[14px] text-dim">
              If you also have a subscription, it keeps renewing until you cancel it from the portal.
            </p>
          )}

          <button type="button" onClick={() => setCheckoutWelcome(null)} className="btn btn-ghost mt-6 w-full">
            Continue to settings
          </button>
        </div>
        {renderErrorToastStack()}
      </Frame>
    );
  }

  // Full auth configuration modal
  if (result && showConfig && preferences && !forceMainForm) {
    return (
      <>
        <ConfigurationModal
          mode="full"
          user={{ username: result.user.username, displayName: result.user.displayName }}
          lists={result.lists}
          onBack={returnToMainForm}
          preferences={preferences}
          onPreferencesChange={setPreferences}
          sortVariants={preferences.sortVariants || {}}
          onSortVariantsChange={(v) => setPreferences({ ...preferences, sortVariants: v })}
          onSave={handleSavePreferences}
          isSaving={isSavingPrefs}
          isStremioLinked={isStremioLinked}
          onStremioLinkedChange={setIsStremioLinked}
          isNuvioLinked={isNuvioLinked}
          onNuvioLinkedChange={setIsNuvioLinked}
          entitled={entitled}
          externalListUrl={externalListUrl}
          onExternalListUrlChange={setExternalListUrl}
          onAddExternalList={handleResolveExternalList}
          isResolvingList={isResolvingList}
          onUpsell={(message) => showUpsellToast(message, 6000)}
        />
        {renderErrorToastStack()}
      </>
    );
  }

  // Public configuration modal
  if (showPublicConfig && !forceMainForm) {
    return (
      <>
        <ConfigurationModal
          mode="public"
          user={usernameValidated ? { username: usernameValidated.username, displayName: usernameValidated.displayName } : undefined}
          lists={usernameValidated?.lists || []}
          onBack={returnToMainForm}
          publicCatalogs={publicCatalogs}
          onPublicCatalogsChange={setPublicCatalogs}
          publicWatchlist={publicWatchlist}
          onPublicWatchlistChange={setPublicWatchlist}
          publicLikedFilms={publicLikedFilms}
          onPublicLikedFilmsChange={setPublicLikedFilms}
          publicOwnLists={publicOwnLists}
          onPublicOwnListsChange={setPublicOwnLists}
          publicLists={publicLists}
          onRemovePublicList={(id) => setPublicLists((prev) => prev.filter((l) => l.id !== id))}
          publicExternalWatchlists={publicExternalWatchlists}
          onRemovePublicExternalWatchlist={(username) => setPublicExternalWatchlists((prev) => prev.filter((w) => w.username !== username))}
          showRatings={showRatings}
          onShowRatingsChange={setShowRatings}
          hideUnreleased={hideUnreleased}
          onHideUnreleasedChange={setHideUnreleased}
          hideNoHomeRelease={hideNoHomeRelease}
          onHideNoHomeReleaseChange={setHideNoHomeRelease}
          publicSearch={publicSearch}
          onPublicSearchChange={setPublicSearch}
          publicCatalogNames={publicCatalogNames}
          onPublicCatalogNamesChange={setPublicCatalogNames}
          publicCatalogOrder={publicCatalogOrder}
          onPublicCatalogOrderChange={setPublicCatalogOrder}
          publicSortVariants={publicSortVariants}
          onPublicSortVariantsChange={setPublicSortVariants}
          externalListUrl={externalListUrl}
          onExternalListUrlChange={setExternalListUrl}
          publicContributors={publicContributors}
          onRemovePublicContributor={(id, kind) => setPublicContributors((prev) => prev.filter((c) => !(c.id === id && c.kind === kind)))}
          onAddExternalList={handleResolvePublicList}
          isResolvingList={isResolvingList}
          onSave={handleInstallPublic}
          isSaving={false}
          onUpsell={(message) => showUpsellToast(message, 6000)}
        />
        {renderErrorToastStack()}
      </>
    );
  }

  // Success screen
  const manifestUrl = result?.manifestUrl || generatedManifestUrl;
  if (manifestUrl && !showConfig && !showPublicConfig && !forceMainForm) {
    return (
      <Frame step={3}>
        <div className="mx-auto w-full max-w-[640px]">
          <div className="validate-mark mx-auto flex h-20 w-20 items-center justify-center" role="img" aria-label="Done">
            <svg className="h-20 w-20 text-foreground" viewBox="0 0 64 64" fill="none" aria-hidden="true">
              <circle className="validate-ring" cx="32" cy="32" r="28" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" transform="rotate(-90 32 32)" />
              <path className="validate-check" d="M20 33l8 8 16-17" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <h1 className="mt-6 text-center text-[28px] font-medium leading-[1.08] tracking-[-0.035em] sm:text-[48px]">
            Your addon is ready.
          </h1>
          <p className="mt-4 text-center text-[18px] text-muted">
            {result
              ? `Welcome, ${result.user.displayName || result.user.username}.`
              : usernameValidated
                ? `Configured for ${usernameValidated.displayName}.`
                : "Install it once, then pick it up in Stremio or Nuvio."}
          </p>

          <div className="surface mt-8 grid gap-6 p-5 sm:p-8">
            {syncOutcome === "synced" ? (
              <div>
                <p className="rounded-control border border-line px-4 py-4 text-center text-[18px]" role="status">
                  Updated in Stremio.
                </p>
                <p className="mt-3 text-center text-[14px] text-dim">
                  TV and mobile may need a restart.{" "}
                  <button type="button" onClick={handleInstallStremio} className="link-quiet">
                    Reinstall manually
                  </button>
                </p>
              </div>
            ) : (
              <div className="grid gap-3">
                <button type="button" onClick={handleInstallStremio} className="btn btn-primary w-full py-4 text-[16px]">
                  Install in Stremio
                </button>
                {syncOutcome === "not-installed" && (
                  <p className="text-center text-[14px] text-muted">
                    Install it once, then your changes sync automatically.
                  </p>
                )}
              </div>
            )}

            <div className="grid gap-2">
              <label htmlFor="manifest-url" className="text-[16px] text-muted">
                Manifest URL, for Stremio and Nuvio
              </label>
              <div className="flex gap-2">
                <input
                  id="manifest-url"
                  type="text"
                  readOnly
                  value={manifestUrl}
                  spellCheck={false}
                  className="field-input h-12 min-w-0 text-[16px]"
                />
                <button type="button" onClick={handleCopy} className="btn btn-ghost shrink-0 px-5">
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            </div>

            {resumeLink && (
              <div className="grid gap-2">
                <label htmlFor="resume-link" className="text-[16px] text-muted">
                  Edit link, reopens this setup on any device
                </label>
                <div className="flex gap-2">
                  <input
                    id="resume-link"
                    type="text"
                    readOnly
                    value={resumeLink}
                    spellCheck={false}
                    className="field-input h-12 min-w-0 text-[16px]"
                  />
                  <button type="button" onClick={handleCopyResumeLink} className="btn btn-ghost shrink-0 px-5">
                    {resumeCopied ? "Copied" : "Copy"}
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="mt-5 flex items-center justify-center gap-6 text-[14px]">
            <button
              type="button"
              onClick={() => {
                setForceMainForm(false);
                if (result) setShowConfig(true);
                else setShowPublicConfig(true);
              }}
              className="link-quiet py-1"
            >
              Reconfigure
            </button>
            <button type="button" onClick={result ? handleLogout : handleReset} className="link-quiet py-1">
              {result ? "Sign out" : "Start over"}
            </button>
          </div>

          <p className="mt-8 text-center text-[14px] text-dim">
            Tip: use{" "}
            <a
              href="https://stremio-addon-manager.vercel.app/"
              target="_blank"
              rel="noopener noreferrer"
              className="link-quiet"
            >
              Stremio Addon Manager
            </a>{" "}
            to rank Stremboxd first.
          </p>
        </div>
        {renderErrorToastStack()}
      </Frame>
    );
  }

  // Main form
  return (
    <Frame step={1}>
      <div className="animate-fade-in mx-auto w-full max-w-[640px]">
        <h1 className="text-center text-[28px] font-medium leading-[1.08] tracking-[-0.035em] sm:text-[40px]">
          {show2FA ? "One more step." : "Connect your Letterboxd."}
        </h1>
        {show2FA && (
          <p className="mt-3 text-center text-[16px] text-muted">Enter the code from your authenticator app.</p>
        )}

        <div className="surface mt-8 p-5 sm:p-8">
          {show2FA ? (
            <div className="grid gap-6">
              <OtpInput
                key={otpKey}
                value={totpCode}
                onChange={setTotpCode}
                onComplete={(code) => void handleSubmit2FA(code)}
                disabled={is2FALoading}
              />
              <button
                type="button"
                onClick={() => {
                  setShow2FA(false);
                  setTotpCode("");
                }}
                className="link-quiet justify-self-center py-1 text-[14px]"
              >
                Back
              </button>
            </div>
          ) : (
            <form
              className="grid gap-6"
              onSubmit={(e) => {
                e.preventDefault();
                handleSubmit();
              }}
            >
              <div role="group" aria-label="Access mode" className="grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  aria-pressed={!fullAccess}
                  onClick={() => {
                    setFullAccess(false);
                    setPasswordPreview("");
                  }}
                  className={`grid content-start gap-1 rounded-card border p-4 text-left transition-colors ${
                    !fullAccess ? "border-foreground bg-raised" : "border-line hover:border-line-strong"
                  }`}
                >
                  <span className="text-[16px] font-medium">Username only</span>
                  <span className="text-[14px] text-dim">Watchlist, lists, Popular. No password.</span>
                </button>
                <button
                  type="button"
                  aria-pressed={fullAccess}
                  onClick={() => setFullAccess(true)}
                  className={`grid content-start gap-1 rounded-card border p-4 text-left transition-colors ${
                    fullAccess ? "border-foreground bg-raised" : "border-line hover:border-line-strong"
                  }`}
                >
                  <span className="text-[16px] font-medium">Full access</span>
                  <span className="text-[14px] text-dim">Adds diary, friends activity and actions.</span>
                </button>
              </div>

              <div className="grid gap-2">
                <label htmlFor="username" className="text-[14px] text-muted">
                  Letterboxd username
                </label>
                <input
                  ref={usernameRef}
                  type="text"
                  id="username"
                  name="username"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="your-username"
                  disabled={isLoading}
                  className="field-input"
                />
              </div>

              {fullAccess && (
                <div className="grid gap-2">
                  <label htmlFor="password" className="text-[14px] text-muted">
                    Password
                  </label>
                  <div className="relative">
                    <input
                      ref={passwordRef}
                      type={showPassword ? "text" : "password"}
                      id="password"
                      name="password"
                      autoComplete="current-password"
                      onChange={(e) => setPasswordPreview(e.target.value)}
                      disabled={isLoading}
                      placeholder="Password"
                      className="field-input pr-12"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((value) => !value)}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      aria-pressed={showPassword}
                      className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-control text-dim transition-colors hover:text-foreground"
                    >
                      {showPassword ? (
                        <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                          <path
                            d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.9 5.1A9.7 9.7 0 0112 5c5 0 8.5 4.2 9.5 7a10.8 10.8 0 01-2.6 3.9M6.1 6.1A10.9 10.9 0 002.5 12c1 2.8 4.5 7 9.5 7 1.5 0 2.9-.4 4.1-1"
                            strokeWidth={1.75}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      ) : (
                        <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                          <path
                            d="M2.5 12C3.5 9.2 7 5 12 5s8.5 4.2 9.5 7c-1 2.8-4.5 7-9.5 7s-8.5-4.2-9.5-7z"
                            strokeWidth={1.75}
                            strokeLinejoin="round"
                          />
                          <circle cx="12" cy="12" r="3" strokeWidth={1.75} />
                        </svg>
                      )}
                    </button>
                  </div>
                  <p className="text-[14px] text-dim">{wide ? PASSWORD_NOTE : PASSWORD_NOTE_SHORT}</p>
                </div>
              )}

              {fullAccess && hasPassword && (
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-[16px] font-medium">Stay signed in</p>
                    <p className="text-[14px] text-dim">Supporters only</p>
                  </div>
                  <Toggle enabled={rememberMe} onToggle={() => setRememberMe(!rememberMe)} label="Stay signed in" />
                </div>
              )}

              <button type="submit" disabled={isLoading} className="btn btn-primary w-full">
                {isLoading ? "Connecting…" : "Continue"}
              </button>
            </form>
          )}
        </div>
      </div>
      {renderErrorToastStack()}
    </Frame>
  );
}
