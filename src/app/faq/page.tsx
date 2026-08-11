"use client";

import { useState, useId } from "react";
import TransitionLink from "../components/TransitionLink";
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
  const tabsId = useId();
  const [active, setActive] = useState(0);
  const [openItems, setOpenItems] = useState<Set<number>>(new Set());

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
    <>
    <div className="fixed inset-0 overflow-y-auto bg-[#0a0a0a] text-white">
      <div className="mx-auto max-w-4xl px-4 py-12 sm:py-20">
        <div className="mb-10 flex items-center justify-between">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">FAQ</h1>
          <TransitionLink
            href="/"
            direction="down"
            className="text-sm font-light text-zinc-500 transition-colors hover:text-zinc-200"
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
          </TransitionLink>
        </div>

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

      <div className="mt-6 text-center text-sm font-light text-zinc-600">
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
    </div>

      <Footer absolute={false} />
    </>
  );
}
