/* eslint-disable @next/next/no-html-link-for-pages -- in-page hash links stay native anchors so the browser fires hashchange */
"use client";

import { useSyncExternalStore } from "react";
import TransitionLink from "./components/TransitionLink";
import SupporterOffer from "./components/SupporterOffer";
import Footer from "./components/Footer";
import SiteHeader from "./components/SiteHeader";
import { OFFERS } from "../lib/offers";
import { track } from "../lib/analytics";

type Pane = "overview" | "free" | "supporter";

const FREE_ITEMS = [
  "Watchlist, liked films and diary",
  "Friends activity",
  "Any public list by URL",
  "Popular this week",
  "Ratings on posters",
  "Rate, like and manage",
  "Sort, shuffle and filter",
  "Stremio and Nuvio",
];

const FLOW = [
  { title: "Your Letterboxd account", text: "Watchlist, diary, lists, friends" },
  { title: "Stremboxd", text: "Turns them into catalogs" },
  { title: "Stremio or Nuvio", text: "Open it like any other addon, on any device" },
];

function subscribeToHash(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

function paneFromHash(hash: string): Pane {
  if (hash === "#free") return "free";
  if (hash === "#supporter") return "supporter";
  return "overview";
}

/**
 * The landing page as a one-screen app: three panes in the same frame, each one
 * reachable by URL hash (real links, shareable, back button works). All panes
 * are in the HTML from the start; only the active one is shown.
 */
export default function HomeShell() {
  const pane = useSyncExternalStore(
    subscribeToHash,
    () => paneFromHash(window.location.hash),
    () => "overview" as Pane
  );

  return (
    <div className="relative flex min-h-dvh flex-col overflow-x-clip">
      <div className="beam" aria-hidden="true" />

      <SiteHeader />

      <main id="main" className="relative z-10 mx-auto flex w-full max-w-[1600px] flex-1 flex-col px-4 sm:px-6 lg:px-8">
        {/* Overview */}
        <section hidden={pane !== "overview"} className="animate-fade-in flex flex-1 flex-col">
          <div className="grid flex-1 items-center gap-10 py-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:gap-14 lg:py-8">
            <div>
              <h1 className="text-[36px] font-medium leading-[1.02] tracking-[-0.04em] sm:text-[48px] lg:text-[58px]">
                Your Letterboxd,
                <br />
                inside Stremio.
              </h1>
              <p className="mt-4 max-w-[40ch] text-base leading-relaxed text-muted sm:text-[17px]">
                Watchlist, diary, friends and lists as catalogs in Stremio and Nuvio. Free, unofficial, and
                staying that way.
              </p>
              <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-3">
                <TransitionLink
                  href="/configure"
                  direction="up"
                  trackTarget="configure"
                  className="btn btn-primary w-full sm:w-auto"
                >
                  Install the addon
                </TransitionLink>
                <a
                  href="/#supporter"
                  onClick={() => track("landing_cta_clicked", { target: "pricing" })}
                  className="link-quiet py-2 text-sm"
                >
                  See what Supporter adds
                </a>
              </div>
            </div>

            <ol className="ml-1.5 border-l border-line-strong">
              {FLOW.map((step) => (
                <li key={step.title} className="relative py-3 pl-6">
                  <span aria-hidden="true" className="absolute -left-[4px] top-[22px] h-[7px] w-[7px] rounded-full bg-foreground" />
                  <p className="text-[15px] font-medium">
                    {step.title === "Stremboxd" ? <span translate="no">{step.title}</span> : step.title}
                  </p>
                  <p className="text-[13.5px] text-dim">{step.text}</p>
                </li>
              ))}
            </ol>
          </div>

          <ul className="mb-6 grid overflow-hidden rounded-card border border-line bg-surface/70 sm:grid-cols-3">
            <li className="border-b border-line sm:border-b-0 sm:border-r">
              <a href="/#free" className="grid h-full gap-1 px-4 py-4 transition-colors hover:bg-raised sm:px-5">
                <span className="text-[15px] font-medium">What is free stays free</span>
                <span className="text-[13px] text-dim">The full list and our commitment</span>
              </a>
            </li>
            <li className="border-b border-line sm:border-b-0 sm:border-r">
              <a href="/#supporter" className="grid h-full gap-1 px-4 py-4 transition-colors hover:bg-raised sm:px-5">
                <span className="text-[13px] text-dim">Supporter</span>
                <span className="text-[22px] font-medium tracking-[-0.03em] tabular-nums">
                  {OFFERS.supporter.price}
                  <span className="ml-1.5 text-[13px] font-normal tracking-normal text-dim">{OFFERS.supporter.period}</span>
                </span>
              </a>
            </li>
            <li>
              <a href="/#supporter" className="grid h-full gap-1 px-4 py-4 transition-colors hover:bg-raised sm:px-5">
                <span className="text-[13px] text-dim">Founder</span>
                <span className="text-[22px] font-medium tracking-[-0.03em] tabular-nums">
                  {OFFERS.founder.price}
                  <span className="ml-1.5 text-[13px] font-normal tracking-normal text-dim">{OFFERS.founder.period}</span>
                </span>
              </a>
            </li>
          </ul>
        </section>

        {/* Free for good */}
        <section hidden={pane !== "free"} className="animate-fade-in flex flex-1 flex-col pb-8 pt-4 lg:pb-12 lg:pt-8">
          <div className="grid gap-8 lg:gap-10">
            <div>
              <h2 className="text-[28px] font-medium leading-[1.08] tracking-[-0.035em] sm:text-[40px]">
                What is free today stays free.
              </h2>
              <p className="mt-3 max-w-[56ch] text-[15.5px] leading-relaxed text-muted">
                This is a commitment, not a promotion. Supporters pay for the hosting and get extra features on
                top. Nothing on this list will move behind a paywall.
              </p>
            </div>

            <ul className="grid border-t border-line sm:grid-cols-2 sm:gap-x-12">
              {FREE_ITEMS.map((item) => (
                <li
                  key={item}
                  className="flex items-baseline justify-between gap-4 border-b border-line py-4 text-[16px]"
                >
                  <span>{item}</span>
                  <span className="font-mono text-[11.5px] text-dim">free</span>
                </li>
              ))}
            </ul>

            <div>
              <TransitionLink
                href="/configure"
                direction="up"
                trackTarget="configure"
                className="btn btn-primary w-full sm:w-auto"
              >
                Install the addon
              </TransitionLink>
            </div>
          </div>
        </section>

        {/* Supporter */}
        <section hidden={pane !== "supporter"} className="animate-fade-in flex flex-1 flex-col pb-8 pt-4 lg:pb-12 lg:pt-8">
          <SupporterOffer />
        </section>
      </main>

      <Footer absolute={false} />
    </div>
  );
}
