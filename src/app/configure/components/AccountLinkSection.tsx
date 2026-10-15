"use client";

import { useEffect, useRef, useState } from "react";
import TransitionLink from "../../components/TransitionLink";
import {
  clearAuthKey,
  createLinkCode as createStremioLinkCode,
  pollAuthKey,
  readAuthKey,
  storeAuthKey,
  type LinkCode as StremioLinkCode,
} from "../../../lib/stremio-sync";
import {
  clearSession,
  createLinkCode as createNuvioLinkCode,
  pollSession,
  readSession,
  type LinkCode as NuvioLinkCode,
} from "../../../lib/nuvio-sync";
import { dismissSupporterBanner, isSupporterBannerDismissed } from "../../../lib/supporter-storage";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";

type Provider = "stremio" | "nuvio";

interface AccountLinkSectionProps {
  stremioLinked: boolean;
  onStremioLinkedChange: (linked: boolean) => void;
  nuvioLinked: boolean;
  onNuvioLinkedChange: (linked: boolean) => void;
  entitled: boolean;
}

export function AccountLinkSection({
  stremioLinked,
  onStremioLinkedChange,
  nuvioLinked,
  onNuvioLinkedChange,
  entitled,
}: AccountLinkSectionProps) {
  const [pairing, setPairing] = useState<Provider | null>(null);
  const [stremioCode, setStremioCode] = useState<StremioLinkCode | null>(null);
  const [nuvioCode, setNuvioCode] = useState<NuvioLinkCode | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Client-only component (rendered after login), so storage is safe to read here.
  const [bannerDismissed, setBannerDismissed] = useState(() => isSupporterBannerDismissed());
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const onStremioLinkedChangeRef = useRef(onStremioLinkedChange);
  const onNuvioLinkedChangeRef = useRef(onNuvioLinkedChange);
  // Keep the latest callbacks without writing refs during render; declared first so it runs
  // before the effects below read them.
  useEffect(() => {
    onStremioLinkedChangeRef.current = onStremioLinkedChange;
    onNuvioLinkedChangeRef.current = onNuvioLinkedChange;
  });

  useEffect(() => {
    mountedRef.current = true;
    onStremioLinkedChangeRef.current(readAuthKey() !== null);
    onNuvioLinkedChangeRef.current(readSession() !== null);
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  const startLinking = async (provider: Provider) => {
    setError(null);
    setPairing(provider);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      if (provider === "stremio") {
        const code = await createStremioLinkCode();
        setStremioCode(code);
        storeAuthKey(await pollAuthKey(code.code, controller.signal));
        onStremioLinkedChange(true);
      } else {
        const code = await createNuvioLinkCode();
        setNuvioCode(code);
        // Nuvio hands back a full session, so pollSession stores it itself.
        await pollSession(code, controller.signal);
        onNuvioLinkedChange(true);
      }
    } catch {
      // Unmounted mid-poll: the component is gone, nothing left to update.
      if (!mountedRef.current) return;
      // A cancel is a deliberate abort, not a failure worth an error message.
      if (!controller.signal.aborted) {
        setError("Linking failed or timed out. Request a new code and try again.");
      }
    } finally {
      if (mountedRef.current) {
        setPairing(null);
        setStremioCode(null);
        setNuvioCode(null);
      }
      abortRef.current = null;
    }
  };

  const cancelLinking = () => {
    abortRef.current?.abort();
  };

  const unlink = (provider: Provider) => {
    if (pairing === provider) {
      abortRef.current?.abort();
    }
    setError(null);
    if (provider === "stremio") {
      clearAuthKey();
      onStremioLinkedChange(false);
    } else {
      clearSession();
      onNuvioLinkedChange(false);
    }
  };

  return (
    <div>
      <div className="flex items-center gap-1.5">
        <h3 className="text-[16px] font-medium text-foreground">Accounts</h3>
        <span
          className="flex h-3.5 w-3.5 cursor-help items-center justify-center text-dim transition-colors hover:text-zinc-300"
          title="Link once and your catalogs update without reinstalling the addon. Your keys stay in this browser and never reach our servers."
        >
          <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="9" strokeWidth={2} />
            <path d="M12 16v-4.5M12 8h.01" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        {entitled && (
          <span className="inline-flex items-center gap-1 rounded-full border border-zinc-600 bg-gradient-to-br from-zinc-700 to-zinc-900 px-2 py-0.5 text-[12px] font-semibold text-white">
            <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2l2.4 7.2H22l-6 4.6 2.3 7.2L12 16.4 5.7 21l2.3-7.2-6-4.6h7.6z" />
            </svg>
            Supporter
          </span>
        )}
      </div>

      {!entitled && !bannerDismissed && (
        <div className="relative mt-2 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/60 px-3.5 py-3">
          <div className="flex items-center gap-3">
            <div className="hidden h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-800 text-zinc-300 sm:flex">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <rect x="5" y="11" width="14" height="9" rx="2" strokeWidth={2} />
                <path d="M8 11V7a4 4 0 018 0v4" strokeWidth={2} strokeLinecap="round" />
              </svg>
            </div>
            <p className="min-w-0 flex-1 text-[12px] leading-snug text-zinc-300">
              {stremioLinked || nuvioLinked ? (
                <>
                  Auto-sync is off. Changes won&apos;t reach{" "}
                  {stremioLinked && nuvioLinked ? "Stremio or Nuvio" : stremioLinked ? "Stremio" : "Nuvio"} until you
                  upgrade.
                </>
              ) : (
                "Supporters get auto-log to diary, auto-sync and a persistent session."
              )}
            </p>
            <TransitionLink
              href="/#supporter"
              direction="up"
              className="flex-shrink-0 whitespace-nowrap rounded-lg bg-white px-3 py-2 text-[12px] font-semibold text-black transition-colors hover:bg-zinc-200"
            >
              Upgrade
            </TransitionLink>
            <button
              type="button"
              onClick={() => {
                dismissSupporterBanner();
                setBannerDismissed(true);
              }}
              aria-label="Dismiss supporter banner"
              className="-mr-1 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-dim transition-colors hover:text-zinc-200"
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {stremioLinked && (
        <LinkedRow label="Stremio" sublabel="Changes sync automatically" onUnlink={() => unlink("stremio")} />
      )}

      {nuvioLinked && (
        <LinkedRow label="Nuvio" sublabel="Changes sync automatically" onUnlink={() => unlink("nuvio")} />
      )}

      {pairing === "stremio" && stremioCode && (
        <div className="mt-3 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            {/* Stremio serves the QR image itself, so no client-side QR library is needed. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={stremioCode.qrcode}
              alt="QR code linking to Stremio"
              className="h-24 w-24 flex-shrink-0 self-start rounded-lg bg-white p-1.5 sm:self-auto"
            />
            <div className="min-w-0 flex-1">
              <p className="text-[12px] text-dim">
                Scan the code, or open{" "}
                <a
                  href={stremioCode.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-zinc-300 underline underline-offset-2 transition-colors hover:text-white"
                >
                  link.stremio.com
                </a>{" "}
                and enter this code:
              </p>
              <p className="ph-no-capture mt-2 rounded-lg bg-black/40 px-3 py-2 text-center font-mono text-2xl tracking-[0.3em] text-white sm:text-left">
                {stremioCode.code}
              </p>
            </div>
          </div>
          <WaitingRow onCancel={cancelLinking} />
        </div>
      )}

      {pairing === "nuvio" && nuvioCode && (
        <div className="mt-3 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <p className="text-[12px] text-dim">
            Open{" "}
            <a
              href={nuvioCode.link}
              target="_blank"
              rel="noopener noreferrer"
              className="text-zinc-300 underline underline-offset-2 transition-colors hover:text-white"
            >
              nuvio.tv/link
            </a>{" "}
            and enter this code:
          </p>
          <p className="ph-no-capture mt-2 rounded-lg bg-black/40 px-3 py-2 text-center font-mono text-2xl tracking-[0.3em] text-white">
            {nuvioCode.code}
          </p>
          <WaitingRow onCancel={cancelLinking} />
        </div>
      )}

      {!stremioCode && !nuvioCode && !(stremioLinked && nuvioLinked) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {!stremioLinked && pairing !== "nuvio" && (
            <LinkButton onClick={() => startLinking("stremio")} disabled={pairing === "stremio"}>
              {pairing === "stremio" ? "..." : "Link Stremio account"}
            </LinkButton>
          )}
          {!nuvioLinked && pairing !== "stremio" && (
            <LinkButton onClick={() => startLinking("nuvio")} disabled={pairing === "nuvio"}>
              {pairing === "nuvio" ? "..." : "Link Nuvio account"}
            </LinkButton>
          )}
        </div>
      )}

      {entitled && (
        <a
          href={`${BACKEND_URL}/billing/portal`}
          className="mt-3 flex items-center gap-2.5 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3.5 py-2.5 transition-colors hover:border-zinc-700 hover:bg-zinc-900"
        >
          <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-zinc-800 text-zinc-400">
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <rect x="2" y="5" width="20" height="14" rx="2" strokeWidth={2} />
              <path d="M2 10h20" strokeWidth={2} />
            </svg>
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[12px] font-medium text-zinc-200">Manage subscription</span>
            <span className="block text-[12px] text-dim">Billing, invoices, cancel</span>
          </span>
          <svg className="h-3.5 w-3.5 flex-shrink-0 text-dim" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path d="M9 18l6-6-6-6" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </a>
      )}

      {error && <p className="mt-2 text-[12px] text-red-400">{error}</p>}
    </div>
  );
}

function LinkedRow({ label, sublabel, onUnlink }: { label: string; sublabel: string; onUnlink: () => void }) {
  return (
    <div className="mt-3 flex items-center gap-3 rounded-lg bg-zinc-800/35 px-3.5 py-2.5">
      <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-emerald-400" />
      <p className="min-w-0 flex-1 text-[14px] text-zinc-300">
        {label} <span className="text-dim">· {sublabel}</span>
      </p>
      <button
        type="button"
        onClick={onUnlink}
        className="flex-shrink-0 text-[12px] text-dim transition-colors hover:text-zinc-200"
      >
        Unlink
      </button>
    </div>
  );
}

function WaitingRow({ onCancel }: { onCancel: () => void }) {
  return (
    <div className="mt-3 flex items-center justify-between gap-2 border-t border-zinc-800 pt-3">
      <span className="flex items-center gap-2 text-[12px] text-dim">
        <svg className="h-3 w-3 animate-spin text-dim" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
        Waiting for confirmation…
      </span>
      <button
        type="button"
        onClick={onCancel}
        className="flex-shrink-0 rounded-md border border-zinc-700 px-2.5 py-1 text-[12px] text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-200"
      >
        Cancel
      </button>
    </div>
  );
}

function LinkButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex-1 whitespace-nowrap rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2.5 text-[14px] text-zinc-300 transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none"
    >
      {children}
    </button>
  );
}
