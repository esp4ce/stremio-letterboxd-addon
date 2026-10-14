import type { Metadata } from "next";
import TransitionLink from "./components/TransitionLink";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};


const FEATURES = [
  "Watchlist & liked films",
  "Diary & friends activity",
  "Any public list by URL",
  "Popular & Top 250",
  "Ratings on posters",
  "Rate, like & manage",
  "Sort, shuffle & filter",
  "Stremio & Nuvio",
];

export default function Home() {
  return (
    <div className="fixed inset-0 flex cursor-default flex-col bg-[#0a0a0a] text-white sm:items-center sm:justify-center">
      <div className="min-h-0 w-full max-w-7xl flex-1 overflow-y-auto px-4 sm:mx-auto sm:-mt-16 sm:flex sm:h-full sm:flex-none sm:flex-col sm:items-center sm:justify-center sm:overflow-visible">
        {/* min-h-full centers the block yet lets it scroll from the top on short screens, where centering the scroller itself would clip it. */}
        <div className="flex min-h-full w-full flex-col items-center justify-center py-8 sm:min-h-0 sm:py-0">
        <h1 className="text-center text-3xl font-semibold tracking-tight text-white sm:text-5xl lg:text-6xl xl:text-7xl">
          Your Letterboxd. Inside Stremio.
        </h1>

        <p className="mt-3 text-center text-lg font-light text-zinc-400 sm:mt-6 sm:text-2xl">
          Free unofficial addon for all platforms.
        </p>

        <div className="mx-auto mt-7 w-full max-w-5xl sm:mt-12">
          <ul className="mx-auto flex w-full flex-wrap justify-center gap-2 sm:grid sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
            {FEATURES.map((feature) => (
              <li
                key={feature}
                className="flex items-center gap-2 rounded-full bg-zinc-900/50 py-1.5 pl-1.5 pr-3.5 sm:gap-3 sm:rounded-xl sm:p-4"
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-xs text-zinc-300 sm:h-8 sm:w-8 sm:text-sm">
                  ✓
                </span>
                <span className="text-sm font-light text-zinc-200 sm:text-base">
                  {feature}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <TransitionLink
          href="/pricing"
          direction="up"
          trackTarget="pricing"
          className="mt-7 block max-w-full rounded-2xl border border-zinc-800 px-4 py-2.5 text-center text-sm font-light text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-200 sm:mt-10 sm:rounded-full sm:px-5"
        >
          <span className="text-zinc-200">Supporters</span> get auto-log to diary, auto-sync & more{" "}
          <span aria-hidden="true">→</span>
        </TransitionLink>

        <div className="mt-4 text-center text-sm font-light text-zinc-500">
          <span>
            <TransitionLink
              href="/faq"
              direction="up"
              trackTarget="faq"
              className="text-zinc-400 underline decoration-zinc-700 underline-offset-2 transition-colors hover:text-zinc-200"
            >
              FAQ
            </TransitionLink>
            {" "} for common questions.
          </span>
        </div>
        </div>
      </div>

      <div className="flex shrink-0 justify-center py-5 sm:absolute sm:bottom-12 sm:py-6">
        <TransitionLink
          href="/configure"
          direction="up"
          trackTarget="configure"
          className="flex h-12 w-12 items-center justify-center rounded-full bg-white transition-all hover:scale-110 hover:bg-zinc-200 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-[#0a0a0a]"
          ariaLabel="Continue to configuration"
        >
          <svg
            className="h-6 w-6 text-black"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 14l-7 7m0 0l-7-7m7 7V3"
            />
          </svg>
        </TransitionLink>
      </div>
    </div>
  );
}
