import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Shared top bar for the inner pages: wordmark on the left, page actions on
 * the right. The landing page builds its own bar because it also carries the
 * in-page section tabs.
 */
export default function SiteHeader({ children }: { children?: ReactNode }) {
  return (
    <header className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3.5 sm:px-6">
      <Link
        href="/"
        translate="no"
        className="rounded-control text-[16px] font-semibold tracking-tight text-foreground"
      >
        Stremboxd
      </Link>
      <div className="flex items-center gap-3 sm:gap-5">{children}</div>
    </header>
  );
}
