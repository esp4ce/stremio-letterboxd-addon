"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, type MouseEvent, type ReactNode } from "react";
import { track } from "../../lib/analytics";

interface TransitionLinkProps {
  href: string;
  className?: string;
  children: ReactNode;
  ariaLabel?: string;
  ariaCurrent?: "page";
  /** Serializable so server components can set it; emits landing_cta_clicked. */
  trackTarget?: "configure" | "pricing" | "faq";
}

/**
 * Custom Link component with View Transitions API support.
 * Cross-fades between pages when the browser supports view transitions.
 */
export default function TransitionLink({
  href,
  className,
  children,
  ariaLabel,
  ariaCurrent,
  trackTarget,
}: TransitionLinkProps) {
  const router = useRouter();

  const handleClick = useCallback(
    (e: MouseEvent<HTMLAnchorElement>) => {
      e.preventDefault();

      if (trackTarget) track("landing_cta_clicked", { target: trackTarget });

      if (document.startViewTransition) {
        document.startViewTransition(() => {
          router.push(href);
        });
      } else {
        router.push(href);
      }
    },
    [href, router, trackTarget]
  );

  return (
    <Link
      href={href}
      onClick={handleClick}
      className={className}
      aria-label={ariaLabel}
      aria-current={ariaCurrent}
    >
      {children}
    </Link>
  );
}
