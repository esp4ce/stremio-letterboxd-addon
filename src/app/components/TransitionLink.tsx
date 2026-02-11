"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, type MouseEvent, type ReactNode } from "react";

interface TransitionLinkProps {
  href: string;
  direction: "up" | "down";
  className?: string;
  children: ReactNode;
  ariaLabel?: string;
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
}: TransitionLinkProps) {
  const router = useRouter();

  const handleClick = useCallback(
    (e: MouseEvent<HTMLAnchorElement>) => {
      e.preventDefault();

      document.documentElement.dataset.transition = direction;

      if (document.startViewTransition) {
        document.startViewTransition(() => {
          router.push(href);
        });
      } else {
        router.push(href);
      }
    },
    [direction, href, router]
  );

  return (
    <Link
      href={href}
      onClick={handleClick}
      className={className}
      aria-label={ariaLabel}
    >
      {children}
    </Link>
  );
}
