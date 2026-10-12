"use client";

import { useState, useId, type MouseEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Footer from "../components/Footer";
import { SECTIONS } from "./data";
import type { FAQItem } from "./data";

function FAQCard({
  item,
  index,
  open,
  onToggle,
}: {
  item: FAQItem;
  index: number;
  open: boolean;
  onToggle: () => void;
}) {
  const baseId = useId();
  const headingId = `${baseId}-q-${index}`;
  const panelId = `${baseId}-a-${index}`;

  return (
    <div className="film-grain rounded-xl bg-zinc-900/50 transition-colors hover:bg-zinc-900">
      <button
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
        id={headingId}
        className="w-full p-5 text-left"
      >
        <div className="flex items-start justify-between gap-3">
          <span className="text-base font-medium text-zinc-200">{item.q}</span>
          <svg
            className={`mt-0.5 h-4 w-4 shrink-0 text-zinc-600 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>
      <div
        id={panelId}
        role="region"
        aria-labelledby={headingId}
        className={`grid transition-[grid-template-rows] duration-200 ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
      >
        <div className="overflow-hidden">
          <p className="px-5 pb-5 text-sm font-light leading-relaxed text-zinc-400">{item.a}</p>
        </div>
      </div>
    </div>
  );
}

export default function FAQ() {
  const router = useRouter();
  const tabsId = useId();
  const [active, setActive] = useState(0);
  const [openItems, setOpenItems] = useState<Set<number>>(new Set());

  // Send Back to wherever the user came from, not a hardcoded page.
  // document.referrer doesn't work here since TransitionLink navigates via
  // router.push — history length is the only reliable signal we have.
  const goBack = (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    document.documentElement.dataset.transition = "down";

    const navigate = () => {
      if (window.history.length > 1) {
        router.back();
      } else {
        router.push("/");
      }
    };

    if (document.startViewTransition) {
      document.startViewTransition(navigate);
    } else {
      navigate();
    }
  };

  function handleTabChange(i: number) {
    setActive(i);
    setOpenItems(new Set());
  }

  function toggleItem(i: number) {
    setOpenItems((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  }

  return (
    <div className="fixed inset-0 overflow-y-auto bg-[#0a0a0a] text-white">
      <div className="relative flex min-h-full flex-col">
      <Link
        href="/"
        onClick={goBack}
        className="absolute left-4 top-4 z-10 text-sm font-light text-zinc-500 transition-colors hover:text-zinc-200 sm:left-6 sm:top-6"
      >
        <svg
          className="inline-block h-4 w-4 mr-1 -mt-0.5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back
      </Link>

      <div className="mx-auto w-full max-w-4xl flex-1 px-4 pt-16 pb-12 sm:pt-24 sm:pb-20">
        <h1 className="mb-10 text-3xl font-semibold tracking-tight sm:text-4xl">FAQ</h1>

        {/* Tabs */}
        <div role="tablist" aria-label="FAQ sections" className="mb-8 flex flex-wrap gap-2">
          {SECTIONS.map((section, i) => (
            <button
              key={section.title}
              role="tab"
              id={`${tabsId}-tab-${i}`}
              aria-selected={active === i}
              aria-controls={`${tabsId}-panel-${i}`}
              onClick={() => handleTabChange(i)}
              className={`rounded-full px-4 py-1.5 text-sm font-light transition-colors ${
                active === i
                  ? "bg-white text-black"
                  : "bg-zinc-900 text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {section.title}
            </button>
          ))}
        </div>

        {/* Panel with fade transition */}
        <div
          key={active}
          role="tabpanel"
          id={`${tabsId}-panel-${active}`}
          aria-labelledby={`${tabsId}-tab-${active}`}
          className="flex flex-col gap-3 animate-fade-in"
        >
          {SECTIONS[active].items.map((item, i) => (
            <FAQCard
              key={item.q}
              item={item}
              index={i}
              open={openItems.has(i)}
              onToggle={() => toggleItem(i)}
            />
          ))}
        </div>
      </div>

      <div className="px-4 text-center text-sm font-light text-zinc-600">
        Still have questions?{" "}
        <a
          href="https://github.com/esp4ce/stremio-letterboxd-addons/issues"
          target="_blank"
          rel="noopener noreferrer"
          className="text-zinc-400 underline decoration-zinc-700 underline-offset-2 transition-colors hover:text-zinc-200"
        >
          Open an issue on GitHub
        </a>
      </div>

      <Footer absolute={false} />
      </div>
    </div>
  );
}
