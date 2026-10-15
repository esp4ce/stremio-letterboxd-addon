"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, type MouseEvent, type ReactNode } from "react";
import { track } from "../../lib/analytics";

interface TransitionLinkProps {
  href: string;
  direction: "up" | "down";
  className?: string;
  children: ReactNode;
  ariaLabel?: string;
  ariaCurrent?: "page";
  /** Serializable so server components can set it; emits landing_cta_clicked. */
  trackTarget?: "configure" | "pricing" | "faq";
}

/**
 * Custom Link component with View Transitions API support.
 * Animates page transitions with slide-up or slide-down effect.
 */
export default function TransitionLink({
  href,
  direction,
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

      document.documentElement.dataset.transition = direction;

      if (document.startViewTransition) {
        document.startViewTransition(() => {
          router.push(href);
        });
      } else {
        router.push(href);
      }
    },
    [direction, href, router, trackTarget]
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
