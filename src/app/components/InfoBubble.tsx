"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

/**
 * A label with an optional small "i" button. The fine print opens inline under
 * the label (tap-friendly, never clipped by a card or the screen edge). Tapping
 * elsewhere or pressing Escape closes it.
 */
export default function InfoBubble({ info, children }: { info?: string; children: ReactNode }) {
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
      <div className="flex items-center gap-1">
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
          className={`-my-1 flex h-8 w-8 flex-shrink-0 cursor-help items-center justify-center rounded-full transition-colors hover:text-foreground ${open ? "text-foreground" : "text-dim"}`}
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="9" strokeWidth={1.75} />
            <path d="M12 16v-4.5M12 8h.01" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      <p
        id={id}
        role="status"
        hidden={!open}
        className="mt-2 max-w-xs rounded-control border border-line-strong bg-background px-3 py-2 text-xs leading-relaxed text-muted"
      >
        {info}
      </p>
    </div>
  );
}
