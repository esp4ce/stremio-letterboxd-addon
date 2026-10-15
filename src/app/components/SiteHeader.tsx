"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore, type ReactNode } from "react";
import TransitionLink from "./TransitionLink";

type NavId = "overview" | "free" | "supporter" | "faq";

const NAV: { id: NavId; label: string; href: string }[] = [
  { id: "overview", label: "Overview", href: "/" },
  { id: "free", label: "Free for good", href: "/#free" },
  { id: "supporter", label: "Supporter", href: "/#supporter" },
  { id: "faq", label: "FAQ", href: "/faq" },
];

function subscribeToHash(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

/**
 * One top bar for every public page: wordmark, the four places a visitor can
 * go, and the install action. `children` adds page-specific controls on the
 * right (for example the way back inside the configuration).
 */
export default function SiteHeader({ children }: { children?: ReactNode }) {
  const pathname = usePathname();
  const hash = useSyncExternalStore(
    subscribeToHash,
    () => window.location.hash,
    () => ""
  );

  const active: NavId | null =
    pathname === "/"
      ? hash === "#free"
        ? "free"
        : hash === "#supporter"
          ? "supporter"
          : "overview"
      : pathname.startsWith("/faq")
        ? "faq"
        : null;

  const onConfigure = pathname.startsWith("/configure");

  return (
    <header className="relative z-10 mx-auto w-full max-w-[1600px] px-4 pt-3.5 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <Link
          href="/"
          translate="no"
          className="order-1 rounded-control text-[16px] font-semibold tracking-tight sm:flex-1"
        >
          Stremboxd
        </Link>

        <nav aria-label="Main" className="order-3 w-full sm:order-2 sm:w-auto">
          <ul className="flex gap-0.5 rounded-card border border-line p-1">
            {NAV.map((item) => (
              <li key={item.id} className="flex-1 sm:flex-none">
                {item.id === "faq" ? (
                  <TransitionLink
                    href={item.href}
                    direction="up"
                    trackTarget="faq"
                    ariaCurrent={active === item.id ? "page" : undefined}
                    className={`block rounded-control px-2.5 py-2 text-center text-[13px] transition-colors sm:px-3 sm:py-1.5 sm:text-[13.5px] ${
                      active === item.id ? "bg-raised text-foreground" : "text-muted hover:text-foreground"
                    }`}
                  >
                    {item.label}
                  </TransitionLink>
                ) : (
                  <a
                    href={item.href}
                    aria-current={active === item.id ? "page" : undefined}
                    className={`block whitespace-nowrap rounded-control px-2.5 py-2 text-center text-[13px] transition-colors sm:px-3 sm:py-1.5 sm:text-[13.5px] ${
                      active === item.id ? "bg-raised text-foreground" : "text-muted hover:text-foreground"
                    }`}
                  >
                    {item.label}
                  </a>
                )}
              </li>
            ))}
          </ul>
        </nav>

        <div className="order-2 ml-auto flex items-center gap-3 sm:order-3 sm:ml-0 sm:flex-1 sm:justify-end sm:gap-4">
          {children}
          {!onConfigure && (
            <TransitionLink
              href="/configure"
              direction="up"
              trackTarget="configure"
              className="btn btn-primary btn-sm"
            >
              <span className="sm:hidden">Install</span>
              <span className="hidden sm:inline">Install the addon</span>
            </TransitionLink>
          )}
        </div>
      </div>
    </header>
  );
}
