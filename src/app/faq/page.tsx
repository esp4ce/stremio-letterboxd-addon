"use client";

import { useId, useMemo, useState, useSyncExternalStore } from "react";
import SiteHeader from "../components/SiteHeader";
import Footer from "../components/Footer";
import { SECTIONS } from "./data";
import type { FAQItem } from "./data";

const slug = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, "-");

function subscribeToHash(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

interface Entry {
  item: FAQItem;
  category: string;
}

/**
 * Categories on the left, questions in the middle, the answer on the right.
 * On small screens the same list reads as an accordion with the answer inline.
 * The category lives in the URL hash so a section can be linked directly.
 */
export default function FAQ() {
  const baseId = useId();
  const hash = useSyncExternalStore(
    subscribeToHash,
    () => window.location.hash.slice(1),
    () => ""
  );
  const categoryIndex = Math.max(
    0,
    SECTIONS.findIndex((section) => slug(section.title) === hash)
  );

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<number | null>(null);

  const entries: Entry[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return SECTIONS[categoryIndex].items.map((item) => ({ item, category: SECTIONS[categoryIndex].title }));
    }
    return SECTIONS.flatMap((section) =>
      section.items
        .filter((item) => `${item.q} ${item.aText ?? (typeof item.a === "string" ? item.a : "")}`.toLowerCase().includes(q))
        .map((item) => ({ item, category: section.title }))
    );
  }, [categoryIndex, query]);

  const searching = query.trim().length > 0;
  const selected = open !== null && open < entries.length ? open : null;
  // Desktop always shows an answer; mobile only shows what was opened.
  const desktopEntry = entries[selected ?? 0];

  return (
    <div className="flex min-h-dvh flex-col lg:h-dvh">
      <SiteHeader />

      <main id="main" className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col px-4 pb-6 sm:px-6 lg:px-8 lg:min-h-0">
        <h1 className="sr-only">Frequently asked questions</h1>
        <div className="mt-4 grid flex-1 grid-cols-1 overflow-hidden rounded-card border border-line lg:mt-8 lg:min-h-0 lg:grid-cols-[240px_minmax(0,400px)_minmax(0,1fr)] lg:grid-rows-[auto_minmax(0,1fr)_auto]">
          <div className="relative border-b border-line lg:col-span-3">
            <label htmlFor={`${baseId}-search`} className="sr-only">
              Search the FAQ
            </label>
            <svg
              className="pointer-events-none absolute left-5 top-1/2 h-5 w-5 -translate-y-1/2 text-dim"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="7" strokeWidth={1.75} />
              <path d="M20 20l-3.5-3.5" strokeWidth={1.75} strokeLinecap="round" />
            </svg>
            <input
              id={`${baseId}-search`}
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setOpen(null);
              }}
              placeholder="Search all questions…"
              autoComplete="off"
              spellCheck={false}
              className="h-14 w-full bg-transparent pl-12 pr-4 text-[16px] text-foreground placeholder:text-dim focus:outline-none focus-visible:bg-raised/40"
            />
          </div>

          <nav
            aria-label="FAQ categories"
            className="flex gap-1 overflow-x-auto border-b border-line p-2 lg:flex-col lg:overflow-visible lg:border-b-0 lg:border-r lg:p-3"
          >
            {SECTIONS.map((section, index) => {
              const active = !searching && index === categoryIndex;
              return (
                <a
                  key={section.title}
                  href={`#${slug(section.title)}`}
                  aria-current={active ? "true" : undefined}
                  onClick={() => {
                    setQuery("");
                    setOpen(null);
                  }}
                  className={`flex shrink-0 items-center justify-between gap-3 rounded-control px-4 py-3 text-[16px] transition-colors ${
                    active ? "bg-raised text-foreground" : "text-muted hover:text-foreground"
                  }`}
                >
                  <span>{section.title}</span>
                  <span className="font-mono text-[14px] text-dim">{section.items.length}</span>
                </a>
              );
            })}
          </nav>

          <ul
            className="panel-scroll max-h-[70dvh] overflow-y-auto p-2 lg:max-h-none lg:border-r lg:border-line"
            aria-label={searching ? "Search results" : SECTIONS[categoryIndex].title}
          >
            {entries.length === 0 && (
              <li className="px-4 py-4 text-[16px] text-dim">
                No question matches. Try another word, or open an issue on GitHub.
              </li>
            )}
            {entries.map((entry, index) => {
              const isOpen = selected === index;
              const isCurrent = (selected ?? 0) === index;
              const panelId = `${baseId}-a-${index}`;
              return (
                <li key={`${entry.category}-${entry.item.q}`}>
                  <button
                    type="button"
                    onClick={() => setOpen(isOpen && window.matchMedia("(max-width: 1023px)").matches ? null : index)}
                    aria-expanded={isOpen}
                    aria-controls={panelId}
                    className={`block w-full rounded-control px-4 py-3.5 text-left text-[16px] leading-snug transition-colors ${
                      isCurrent ? "lg:bg-raised lg:text-foreground" : ""
                    } ${isOpen ? "text-foreground" : "text-muted hover:text-foreground"}`}
                  >
                    {searching && <span className="mb-0.5 block font-mono text-[14px] text-dim">{entry.category}</span>}
                    {entry.item.q}
                  </button>
                  {/* Inline answer for small screens; desktop reads it in the right-hand pane. */}
                  <div id={panelId} hidden={!isOpen} className="px-4 pb-4 text-[16px] leading-relaxed text-muted lg:hidden">
                    {entry.item.a}
                  </div>
                </li>
              );
            })}
          </ul>

          <section
            aria-live="polite"
            className="panel-scroll hidden overflow-y-auto p-8 lg:block lg:p-12"
          >
            {desktopEntry && (
              <article key={desktopEntry.item.q} className="animate-fade-in">
                <p className="font-mono text-[14px] text-dim">{desktopEntry.category}</p>
                <h2 className="mt-3 max-w-[26ch] text-[28px] font-medium leading-[1.12] tracking-[-0.035em] lg:text-[40px]">
                  {desktopEntry.item.q}
                </h2>
                <div className="mt-5 max-w-[60ch] text-[18px] leading-relaxed text-muted [&_a]:text-foreground">
                  {desktopEntry.item.a}
                </div>
              </article>
            )}
          </section>

          <div className="flex flex-col gap-3 border-t border-line px-4 py-4 sm:flex-row sm:items-center sm:justify-between lg:col-span-3 lg:px-6">
            <p className="text-[16px] text-muted">Still have questions?</p>
            <a
              href="https://github.com/esp4ce/stremio-letterboxd-addons/issues/new"
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-ghost w-full sm:w-auto"
            >
              Open an issue on GitHub
            </a>
          </div>
        </div>
      </main>

      <Footer absolute={false} />
    </div>
  );
}
