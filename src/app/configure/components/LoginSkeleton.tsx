"use client";

import { useEffect, useState } from "react";

// Past this point the wait is no longer "a blink", so say so.
const SLOW_AFTER_MS = 4000;

function Bar({ className }: { className: string }) {
  return <div className={`rounded-control bg-raised motion-safe:animate-pulse ${className}`} />;
}

/**
 * Login form drawn as placeholders while the session restore is in flight.
 * It mirrors the real form's blocks and sizes so nothing jumps when it lands;
 * only the heading is real text, because it never depends on the session.
 */
export function LoginSkeleton() {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="mx-auto w-full max-w-[640px]" aria-busy="true">
      <h1 className="text-center text-[28px] font-medium leading-[1.08] tracking-[-0.035em] sm:text-[40px]">
        Connect your Letterboxd.
      </h1>

      <div role="status" className="relative mt-8">
        <span className="sr-only">Loading your session</span>

        <div className="surface grid gap-6 p-5 sm:p-8">
          <div className="grid gap-3 sm:grid-cols-2">
            {[0, 1].map((tile) => (
              <div key={tile} className="grid content-start gap-1 rounded-card border border-line p-4">
                <Bar className="h-6 w-28" />
                <Bar className="h-5 w-full" />
              </div>
            ))}
          </div>

          <div className="grid gap-2">
            <Bar className="h-5 w-36" />
            <Bar className="h-11 w-full" />
          </div>

          <div className="grid gap-2">
            <Bar className="h-5 w-20" />
            <Bar className="h-11 w-full" />
            <Bar className="h-5 w-3/4" />
          </div>

          <Bar className="h-10 w-full" />
        </div>

        {/* Out of the flow, so the card keeps the form's height and nothing shifts. */}
        <p className="absolute inset-x-0 top-full mt-4 text-center text-[14px] text-dim">
          {slow ? "Taking longer than usual. Hang on." : null}
        </p>
      </div>
    </div>
  );
}
