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

  const busy = pairing !== null;

  return (
    <div>
      <h3 className="text-[18px] font-medium text-foreground">Link your player</h3>
      <p className="mt-1 text-[14px] text-dim">
        Link once and your catalogs update without reinstalling the addon. Your keys stay in this browser and never
        reach our servers.
      </p>

      <div className="mt-4 space-y-2">
        <PlayerRow
          name="Stremio"
          linked={stremioLinked}
          entitled={entitled}
          linking={pairing === "stremio"}
          disabled={busy && pairing !== "stremio"}
          onLink={() => startLinking("stremio")}
          onUnlink={() => unlink("stremio")}
        />

        {pairing === "stremio" && stremioCode && (
          <div className="rounded-card border border-line bg-surface p-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              {/* Stremio serves the QR image itself, so no client-side QR library is needed. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={stremioCode.qrcode}
                alt="QR code linking to Stremio"
                className="h-24 w-24 flex-shrink-0 self-start rounded-control bg-foreground p-1.5 sm:self-auto"
              />
              <div className="min-w-0 flex-1">
                <p className="text-[14px] text-muted">
                  Scan the code, or open{" "}
                  <a
                    href={stremioCode.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-foreground underline underline-offset-2"
                  >
                    link.stremio.com
                  </a>{" "}
                  and enter this code:
                </p>
                <p className="ph-no-capture mt-2 rounded-control bg-background/70 px-3 py-2 text-center font-mono text-[24px] tracking-[0.3em] text-foreground sm:text-left">
                  {stremioCode.code}
                </p>
              </div>
            </div>
            <WaitingRow onCancel={cancelLinking} />
          </div>
        )}

        <PlayerRow
          name="Nuvio"
          linked={nuvioLinked}
          entitled={entitled}
          linking={pairing === "nuvio"}
          disabled={busy && pairing !== "nuvio"}
          onLink={() => startLinking("nuvio")}
          onUnlink={() => unlink("nuvio")}
        />

        {pairing === "nuvio" && nuvioCode && (
          <div className="rounded-card border border-line bg-surface p-4">
            <p className="text-[14px] text-muted">
              Open{" "}
              <a
                href={nuvioCode.link}
                target="_blank"
                rel="noopener noreferrer"
                className="text-foreground underline underline-offset-2"
              >
                nuvio.tv/link
              </a>{" "}
              and enter this code:
            </p>
            <p className="ph-no-capture mt-2 rounded-control bg-background/70 px-3 py-2 text-center font-mono text-[24px] tracking-[0.3em] text-foreground">
              {nuvioCode.code}
            </p>
            <WaitingRow onCancel={cancelLinking} />
          </div>
        )}

        {entitled ? (
          <div className={ROW}>
            <div className="min-w-0">
              <p className="text-[16px] font-medium text-foreground">Subscription</p>
              <p className="mt-0.5 text-[14px] text-dim">Billing, invoices, cancel.</p>
            </div>
            <a href={`${BACKEND_URL}/billing/portal`} className="btn btn-ghost btn-sm shrink-0">
              Manage
            </a>
          </div>
        ) : (
          <div className={ROW}>
            <div className="min-w-0">
              <p className="text-[16px] font-medium text-foreground">Supporter</p>
              <p className="mt-0.5 text-[14px] text-dim">Auto-sync, auto-log to diary and a persistent session.</p>
            </div>
            <TransitionLink href="/#supporter" className="btn btn-primary btn-sm shrink-0">
              See Supporter
            </TransitionLink>
          </div>
        )}
      </div>

      {error && (
        <p className="mt-3 text-[14px] text-red-400" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

const ROW = "flex items-center justify-between gap-4 rounded-control bg-raised px-4 py-3.5";

function PlayerRow({
  name,
  linked,
  entitled,
  linking,
  disabled,
  onLink,
  onUnlink,
}: {
  name: string;
  linked: boolean;
  entitled: boolean;
  linking: boolean;
  disabled: boolean;
  onLink: () => void;
  onUnlink: () => void;
}) {
  const description = linked
    ? entitled
      ? `Linked. Changes reach ${name} on their own.`
      : "Linked. Automatic updates need Supporter."
    : entitled
      ? `Changes reach ${name} on their own.`
      : "Automatic updates are a Supporter feature.";

  return (
    <div className={ROW}>
      <div className="min-w-0">
        <p className="text-[16px] font-medium text-foreground">{name}</p>
        <p className="mt-0.5 text-[14px] text-dim">{description}</p>
      </div>
      {linked ? (
        <button type="button" onClick={onUnlink} className="btn btn-ghost btn-sm shrink-0">
          Unlink
        </button>
      ) : (
        <button
          type="button"
          onClick={onLink}
          disabled={disabled || linking || !entitled}
          title={entitled ? undefined : "Available with Supporter"}
          className="btn btn-ghost btn-sm shrink-0"
        >
          {linking ? "Linking…" : "Link"}
        </button>
      )}
    </div>
  );
}

function WaitingRow({ onCancel }: { onCancel: () => void }) {
  return (
    <div className="mt-3 flex items-center justify-between gap-2 border-t border-line pt-3">
      <span className="text-[14px] text-dim" role="status">
        Waiting for confirmation…
      </span>
      <button type="button" onClick={onCancel} className="btn btn-ghost btn-sm shrink-0">
        Cancel
      </button>
    </div>
  );
}
