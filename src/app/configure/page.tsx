"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import TransitionLink from "../components/TransitionLink";
import Footer from "../components/Footer";
import ConfigurationModal from "./ConfigurationModal";
import { Toggle } from "./components/primitives";
import type { UserPreferences } from "../../types/preferences";
import { readAuthKey, syncAddon, type SyncResult } from "../../lib/stremio-sync";
import { readSession as readNuvioSession, syncAddon as syncNuvioAddon } from "../../lib/nuvio-sync";
import { track } from "../../lib/analytics";
import { authHeaders, getInMemorySessionToken, setInMemorySessionToken } from "../../lib/session-token";

const TOAST_DURATION = 3000;
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
  message: string;
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

export default function Configure() {
  return (
    <Suspense fallback={<div className="fixed inset-0 bg-[#0a0a0a]" />}>
      <ConfigureInner />
    </Suspense>
  );
}

// useSearchParams() requires a Suspense boundary above it for the static
// shell — the actual read never suspends at runtime, this is build-time only.
function ConfigureInner() {
  const searchParams = useSearchParams();
  const [confirmingCheckout, setConfirmingCheckout] = useState(searchParams.get("checkout") === "success");
  const [checkoutNeedsLogin, setCheckoutNeedsLogin] = useState(false);
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
  const mainModalRef = useRef<HTMLDivElement>(null);
  const arrowShellRef = useRef<HTMLDivElement>(null);
  const mainFormScrollRef = useRef<HTMLDivElement>(null);
  const toastIdRef = useRef(0);
  const [passwordPreview, setPasswordPreview] = useState("");
  const [arrowTopPx, setArrowTopPx] = useState(24);
  const hasPassword = passwordPreview.trim().length > 0;
  // Default on: matches the pre-existing always-persist behavior for
  // supporters. Has no effect for non-supporters (no cookie either way).
  const [rememberMe, setRememberMe] = useState(true);

  useEffect(() => {
    const updateArrowPosition = () => {
      const modalEl = mainModalRef.current;
      const arrowEl = arrowShellRef.current;
      if (!modalEl || !arrowEl) return;

      const modalTop = modalEl.getBoundingClientRect().top;
      const arrowHeight = arrowEl.getBoundingClientRect().height;
      // Keep equal spacing above and below the arrow: top gap == gap to modal.
      const nextTop = Math.max(12, (modalTop - arrowHeight) / 2);
      setArrowTopPx(nextTop);
    };

    updateArrowPosition();

    const resizeObserver = new ResizeObserver(updateArrowPosition);
    if (mainModalRef.current) resizeObserver.observe(mainModalRef.current);
    if (arrowShellRef.current) resizeObserver.observe(arrowShellRef.current);

    const scrollEl = mainFormScrollRef.current;
    window.addEventListener("resize", updateArrowPosition);
    scrollEl?.addEventListener("scroll", updateArrowPosition, { passive: true });

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateArrowPosition);
      scrollEl?.removeEventListener("scroll", updateArrowPosition);
    };
  }, []);

  const dismissToast = (id: number) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  };

  const showErrorToast = (message: string) => {
    const id = ++toastIdRef.current;
    setToasts((prev) => [...prev, { id, message, tone: "error" }]);
    setTimeout(() => dismissToast(id), TOAST_DURATION);
  };

  const showUpsellToast = (message: string, durationMs = TOAST_DURATION) => {
    const id = ++toastIdRef.current;
    setToasts((prev) => [...prev, { id, message, tone: "upsell" }]);
    setTimeout(() => dismissToast(id), durationMs);
  };

  const showSuccessToast = (message: string) => {
    const id = ++toastIdRef.current;
    setToasts((prev) => [...prev, { id, message, tone: "success" }]);
    setTimeout(() => dismissToast(id), TOAST_DURATION);
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

  const ErrorToastStack = () => {
    if (toasts.length === 0) return null;

    return (
      <div className="pointer-events-none fixed right-6 top-6 z-[90] flex w-[min(92vw,360px)] flex-col gap-2.5">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="pointer-events-auto animate-fade-in relative overflow-hidden rounded-xl border border-zinc-700/80 bg-black/95 px-4 py-3.5 shadow-2xl"
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
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                {toast.tone === "upsell" ? "Heads up" : toast.tone === "success" ? "Success" : "Error"}
              </p>
              <p className="mt-1 text-sm leading-relaxed text-zinc-100">{toast.message}</p>
            </div>
            <button
              type="button"
              onClick={() => dismissToast(toast.id)}
              className="absolute right-2.5 top-2.5 text-zinc-500 transition-colors hover:text-zinc-200"
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
  // subscription instead of showing a stale unpaid UI.
  useEffect(() => {
    if (!confirmingCheckout) return;

    let cancelled = false;
    const deadline = Date.now() + 20_000;
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
                setConfirmingCheckout(false);
                showSuccessToast("Payment confirmed - thanks for your support!");
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
      if (!cancelled) setConfirmingCheckout(false);
    };

    void poll();
    return () => {
      cancelled = true;
    };
  }, [confirmingCheckout]);

  const handleSubmit = async () => {
    const username = usernameRef.current?.value?.trim();
    const password = passwordRef.current?.value?.trim();

    if (!username) {
      showErrorToast("Please enter your Letterboxd username");
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

        applyLoginResult(data as LoginResponse, true);
        track("login_succeeded", { method: "password", entitled: (data as LoginResponse).entitled, remember_me: rememberMe });
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

  const handleSubmit2FA = async () => {
    const username = usernameRef.current?.value?.trim();
    const password = passwordRef.current?.value?.trim();

    if (!username || !password || !totpCode.trim()) return;

    setIs2FALoading(true);
    try {
      const response = await fetch(`${BACKEND_URL}/auth/login`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ username, password, totp: totpCode.trim(), rememberMe }),
      });

      const data = await response.json();

      if (!response.ok) {
        const errorData = data as LoginError;
        throw new Error(errorData.error || "Authentication failed");
      }

      setShow2FA(false);
      setTotpCode("");
      applyLoginResult(data as LoginResponse, true);
      track("login_succeeded", { method: "totp", entitled: (data as LoginResponse).entitled, remember_me: rememberMe });
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : "Invalid code");
    } finally {
      setIs2FALoading(false);
    }
  };

  const handleSavePreferences = async () => {
    if (!result || !preferences) return;

    setIsSavingPrefs(true);
    setSyncOutcome(null);
    try {
      const response = await fetch(`${BACKEND_URL}/auth/preferences`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ preferences }),
      });

      if (!response.ok) throw new Error("Failed to save preferences");

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
          "Preferences saved. Auto-sync to Stremio/Nuvio requires a Stremboxd supporter subscription — reinstall the addon manually to pick up changes, or subscribe for automatic sync."
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

  // Just returned from a checkout: hold here until the supporter
  // entitlement is confirmed (or the 20s deadline passes), then fall through as normal.
  if (confirmingCheckout) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 px-6 text-center">
        <div className="max-w-sm">
          {checkoutNeedsLogin ? (
            <>
              <p className="text-sm text-zinc-300">Payment received. Thanks for supporting Stremboxd.</p>
              <p className="mt-2 text-[12px] text-zinc-500">
                This tab lost your session during checkout. Log back in to activate your supporter session.
              </p>
              <button
                type="button"
                onClick={() => setConfirmingCheckout(false)}
                className="mt-5 w-full cursor-pointer rounded-xl bg-white px-4 py-3 text-[15px] font-semibold text-black transition-all hover:bg-zinc-200 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-zinc-950"
              >
                Log in
              </button>
            </>
          ) : (
            <>
              <p className="text-sm text-zinc-300">Confirming your payment…</p>
              <p className="mt-2 text-[12px] text-zinc-500">
                This can take a minute. If nothing happens, reload this page.
              </p>
            </>
          )}
        </div>
      </div>
    );
  }

  // Session restore in flight: hold the frame instead of flashing the login form
  if (isRestoringSession) {
    return <div className="fixed inset-0 bg-[#0a0a0a]" />;
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
        <ErrorToastStack />
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
        <ErrorToastStack />
      </>
    );
  }

  // Success screen
  const manifestUrl = result?.manifestUrl || generatedManifestUrl;
  if (manifestUrl && !showConfig && !showPublicConfig && !forceMainForm) {
    return (
      <div className="fixed inset-0 flex h-screen w-screen items-center justify-center bg-[#0a0a0a] text-white">
        <div className="w-full max-w-md px-6 sm:px-8">
          <div className="film-grain animate-fade-in relative overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900 p-7 shadow-2xl sm:p-8">
            <div className="mb-5 flex justify-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-green-500/15 ring-1 ring-green-500/25">
                <svg className="h-7 w-7 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
            </div>

            <h2 className="mt-1 text-center text-2xl font-semibold text-white">Addon Ready!</h2>

            <p className="mt-2 text-center text-[13px] text-zinc-400">
              {result
                ? `Welcome, ${result.user.displayName || result.user.username}!`
                : usernameValidated
                  ? `Configured for ${usernameValidated.displayName}`
                  : "Your addon is ready to install"}
            </p>

            <div className="mt-6">
              {syncOutcome === "synced" ? (
                <>
                  <div className="flex items-center justify-center gap-2 rounded-lg bg-zinc-800/35 px-4 py-3">
                    <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-emerald-400" />
                    <p className="text-[13px] text-zinc-300">Updated in Stremio.</p>
                  </div>
                  <p className="mt-2 text-center text-[11px] text-zinc-500">
                    TV and mobile may need a restart.{" "}
                    <button
                      type="button"
                      onClick={handleInstallStremio}
                      className="cursor-pointer underline underline-offset-2 transition-colors hover:text-zinc-300"
                    >
                      Reinstall manually
                    </button>
                  </p>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={handleInstallStremio}
                    className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-white px-4 py-3 text-[15px] font-semibold text-black transition-all hover:bg-zinc-200 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-zinc-900"
                  >
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    Install in Stremio
                  </button>

                  {syncOutcome === "not-installed" && (
                    <p className="mt-3 text-center text-[13px] text-zinc-400">
                      Install it once, then your changes sync automatically.
                    </p>
                  )}
                </>
              )}

              <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-800/35 p-3">
                <label className="block text-[10px] uppercase tracking-[0.12em] text-zinc-500">Manifest URL</label>
                <div className="mt-2 flex gap-2">
                  <input
                    type="text"
                    readOnly
                    value={manifestUrl}
                    className="block h-10 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 text-[12px] text-zinc-300 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="h-10 flex-shrink-0 rounded-lg border border-zinc-700 bg-zinc-800 px-3 text-xs text-zinc-300 transition-colors hover:bg-zinc-700"
                  >
                    {copied ? "✓" : "Copy"}
                  </button>
                </div>
              </div>

              {resumeLink && (
                <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-800/35 p-3">
                  <label className="block text-[10px] uppercase tracking-[0.12em] text-zinc-500">
                    Edit link: reopens this configuration on any device
                  </label>
                  <div className="mt-2 flex gap-2">
                    <input
                      type="text"
                      readOnly
                      value={resumeLink}
                      className="block h-10 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 text-[12px] text-zinc-300 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={handleCopyResumeLink}
                      className="h-10 flex-shrink-0 rounded-lg border border-zinc-700 bg-zinc-800 px-3 text-xs text-zinc-300 transition-colors hover:bg-zinc-700"
                    >
                      {resumeCopied ? "✓" : "Copy"}
                    </button>
                  </div>
                </div>
              )}

              <div className="mt-4 flex items-center justify-center gap-3 text-xs text-zinc-500">
                <button
                  type="button"
                  onClick={() => {
                    setForceMainForm(false);
                    if (result) setShowConfig(true);
                    else setShowPublicConfig(true);
                  }}
                  className="transition-colors hover:text-zinc-300"
                >
                  Reconfigure
                </button>
                <span className="text-zinc-700">|</span>
                <button
                  type="button"
                  onClick={result ? handleLogout : handleReset}
                  className="transition-colors hover:text-zinc-300"
                >
                  {result ? "Sign out" : "Start over"}
                </button>
              </div>
            </div>

            <div className="mt-5 border-t border-zinc-800 pt-4">
              <p className="text-center text-[11px] font-light leading-relaxed text-zinc-500">
                Tip: use{" "}
                <a
                  href="https://stremio-addon-manager.vercel.app/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-zinc-300 underline decoration-zinc-600 underline-offset-2 transition-colors hover:text-white hover:decoration-zinc-400"
                >
                  Stremio Addon Manager
                </a>{" "}
                to rank Stremboxd first.
              </p>
            </div>
          </div>
        </div>

        <Footer />
        <ErrorToastStack />
      </div>
    );
  }

  // Main form
  return (
    <div ref={mainFormScrollRef} className="fixed inset-0 overflow-y-auto bg-[#0a0a0a] text-white">
      <div className="flex min-h-screen w-full flex-col items-center justify-center px-6 py-10 sm:px-8 sm:py-12">
        <div
          ref={arrowShellRef}
          className="fixed left-1/2 z-20 -translate-x-1/2"
          style={{ top: `${arrowTopPx}px` }}
        >
          <TransitionLink
            href="/"
            direction="down"
            className="flex h-[clamp(2.875rem,3vw,4rem)] w-[clamp(2.875rem,3vw,4rem)] items-center justify-center rounded-full bg-white transition-all hover:scale-110 hover:bg-zinc-200 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-[#0a0a0a]"
            ariaLabel="Back to home"
          >
            <svg className="h-[clamp(1.0625rem,1.2vw,1.625rem)] w-[clamp(1.0625rem,1.2vw,1.625rem)] text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
            </svg>
          </TransitionLink>
        </div>

        <div className="w-full max-w-lg">
          <div ref={mainModalRef} className="film-grain animate-fade-in relative w-full overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900 p-7 shadow-2xl sm:p-8">
            <h2
              className="text-center text-2xl font-semibold text-white sm:text-3xl"
            >
              Configure your addon
            </h2>
            <p className="mx-auto mt-2.5 max-w-lg text-center text-xs leading-relaxed text-zinc-400 ">
              Password is optional for diary, friends activity and full Letterboxd controls.
            </p>

            <form
              className="mt-7 space-y-5"
              onSubmit={(e) => {
                e.preventDefault();
                handleSubmit();
              }}
            >
              <div>
                <label htmlFor="username" className="block text-[13px] font-medium text-zinc-300">
                  Username
                  <span className="ml-1 text-xs text-zinc-500">*</span>
                </label>
                <input
                  ref={usernameRef}
                  type="text"
                  id="username"
                  name="username"
                  autoComplete="username"
                  placeholder="your-username"
                  disabled={isLoading}
                  className="mt-2 block w-full rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-2.5 text-sm text-white placeholder-zinc-500 transition-colors focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 disabled:cursor-not-allowed disabled:opacity-50"
                />
              </div>

              <div>
                <div className="flex items-center justify-between gap-3">
                  <label htmlFor="password" className="block text-[13px] font-medium text-zinc-300">
                    Password
                  </label>
                </div>
                <input
                  ref={passwordRef}
                  type="password"
                  id="password"
                  name="password"
                  autoComplete="current-password"
                  onChange={(e) => setPasswordPreview(e.target.value)}
                  placeholder="**************"
                  disabled={isLoading}
                  className="mt-2 block w-full rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-2.5 text-sm text-white placeholder-zinc-500 transition-colors focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 disabled:cursor-not-allowed disabled:opacity-50"
                />
              </div>

              {hasPassword && (
                <div className="flex items-center justify-between rounded-lg bg-zinc-800/35 px-3.5 py-3">
                  <div>
                    <p className="text-[13px] font-medium text-white">Stay Signed In</p>
                    <p className="mt-0.5 text-[11px] text-zinc-500">
                      Supporters only. Skips the Letterboxd login next visit.
                    </p>
                  </div>
                  <Toggle enabled={rememberMe} onToggle={() => setRememberMe(!rememberMe)} />
                </div>
              )}

              <div className="rounded-xl border border-zinc-800 bg-zinc-800/30 px-3.5 py-2.5">
                <p className="text-[10px] uppercase tracking-[0.14em] text-zinc-500">Mode</p>
                <p className="mt-1 text-[13px] text-zinc-200">
                  {hasPassword ? "Full access" : "Username only"}
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  {hasPassword
                    ? "Includes diary, friends activity and all Letterboxd actions from Stremio."
                    : "Includes popular films, Top 250, watchlist and lists."}
                </p>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-[15px] font-semibold text-black transition-all hover:bg-zinc-200 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-zinc-900 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isLoading ? (
                  <>
                    <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Connecting...
                  </>
                ) : (
                  "Generate my addon"
                )}
              </button>

              <p className="cursor-default text-center text-xs text-zinc-500">
                Your password is only used to authenticate with Letterboxd.
                <br />
                We store an encrypted refresh token, not your raw password.
              </p>
            </form>
          </div>
        </div>
      </div>
      {show2FA && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="film-grain animate-fade-in w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-900 p-7 shadow-2xl">
            <h3 className="text-center text-lg font-semibold text-white">Two-Factor Authentication</h3>
            <p className="mt-2 text-center text-xs text-zinc-400">
              Enter the 6-digit code from your authenticator app.
            </p>
            <form
              className="mt-5 space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                handleSubmit2FA();
              }}
            >
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="000000"
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                autoFocus
                disabled={is2FALoading}
                className="block w-full rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-3 text-center text-2xl font-mono tracking-[0.3em] text-white placeholder-zinc-600 transition-colors focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 disabled:cursor-not-allowed disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={is2FALoading || totpCode.length !== 6}
                className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-[15px] font-semibold text-black transition-all hover:bg-zinc-200 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-zinc-900 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {is2FALoading ? (
                  <>
                    <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Verifying...
                  </>
                ) : (
                  "Verify"
                )}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShow2FA(false);
                  setTotpCode("");
                }}
                className="w-full text-center text-xs text-zinc-500 transition-colors hover:text-zinc-300"
              >
                Cancel
              </button>
            </form>
          </div>
        </div>
      )}
      <Footer />
      <ErrorToastStack />
    </div>
  );
}

