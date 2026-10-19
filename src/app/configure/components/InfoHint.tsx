"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

interface InfoHintProps {
  /** The row title the icon sits next to */
  title: ReactNode;
  /** Accessible name of the icon, e.g. "About Auto-log to Diary" */
  label: string;
  details: string;
}

/**
 * A row title followed by an "i" icon. A title attribute never shows on touch screens,
 * so the details live in a bubble opened by tapping the icon and closed by tapping
 * anywhere else.
 */
export function InfoHint({ title, label, details }: InfoHintProps) {
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePress = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePress);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePress);
  }, [open]);

  return (
    <div ref={ref} className="relative flex items-center gap-1.5">
      <p className="text-[16px] font-medium text-foreground">{title}</p>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
        aria-expanded={open}
        aria-controls={detailsId}
        aria-label={label}
        title={open ? undefined : details}
        className={`-m-2 flex flex-shrink-0 cursor-help items-center justify-center rounded-full p-2 transition-colors hover:text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-control ${open ? "text-foreground" : "text-dim"}`}
      >
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="9" strokeWidth={2} />
          <path d="M12 16v-4.5M12 8h.01" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <p
        id={detailsId}
        role="status"
        hidden={!open}
        className="absolute top-full left-0 z-20 mt-2 w-60 max-w-[calc(100vw-5rem)] rounded-control border border-line-strong bg-background px-3 py-2 text-[12px] leading-relaxed text-foreground shadow-xl"
      >
        {details}
      </p>
    </div>
  );
}
