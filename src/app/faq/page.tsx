"use client";

import { useId, useMemo, useState, useSyncExternalStore } from "react";
import SiteHeader from "../components/SiteHeader";
import TransitionLink from "../components/TransitionLink";
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
      <SiteHeader>
        <TransitionLink href="/configure" direction="up" trackTarget="configure" className="btn btn-primary btn-sm">
          <span className="sm:hidden">Install</span>
          <span className="hidden sm:inline">Install the addon</span>
        </TransitionLink>
      </SiteHeader>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 pb-6 sm:px-6 lg:min-h-0">
        <div className="flex flex-col gap-4 pb-5 pt-4 sm:flex-row sm:items-end sm:justify-between">
          <h1 className="text-[30px] font-medium leading-none tracking-[-0.035em] sm:text-[40px]">FAQ</h1>
          <div className="w-full sm:max-w-xs">
            <label htmlFor={`${baseId}-search`} className="sr-only">
              Search the FAQ
            </label>
            <input
              id={`${baseId}-search`}
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setOpen(null);
              }}
              placeholder="Search the FAQ…"
              autoComplete="off"
              spellCheck={false}
              className="field-input"
            />
          </div>
        </div>

        <div className="grid flex-1 grid-cols-1 overflow-hidden rounded-card border border-line lg:min-h-0 lg:grid-cols-[200px_minmax(0,340px)_minmax(0,1fr)]">
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
                  className={`flex shrink-0 items-center justify-between gap-3 rounded-control px-3 py-2.5 text-[14px] transition-colors ${
                    active ? "bg-raised text-foreground" : "text-muted hover:text-foreground"
                  }`}
                >
                  <span>{section.title}</span>
                  <span className="font-mono text-[11.5px] text-dim">{section.items.length}</span>
                </a>
              );
            })}
          </nav>

          <ul
            className="panel-scroll max-h-[70dvh] overflow-y-auto p-2 lg:max-h-none lg:border-r lg:border-line"
            aria-label={searching ? "Search results" : SECTIONS[categoryIndex].title}
          >
            {entries.length === 0 && (
              <li className="px-3 py-4 text-sm text-dim">
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
                    className={`block w-full rounded-control px-3 py-3 text-left text-[14.5px] leading-snug transition-colors ${
                      isCurrent ? "lg:bg-raised lg:text-foreground" : ""
                    } ${isOpen ? "text-foreground" : "text-muted hover:text-foreground"}`}
                  >
                    {searching && <span className="mb-0.5 block font-mono text-[11px] text-dim">{entry.category}</span>}
                    {entry.item.q}
                  </button>
                  {/* Inline answer for small screens; desktop reads it in the right-hand pane. */}
                  <div id={panelId} hidden={!isOpen} className="px-3 pb-4 text-[14.5px] leading-relaxed text-muted lg:hidden">
                    {entry.item.a}
                  </div>
                </li>
              );
            })}
          </ul>

          <section
            aria-live="polite"
            className="panel-scroll hidden overflow-y-auto p-8 lg:block"
          >
            {desktopEntry && (
              <article key={desktopEntry.item.q} className="animate-fade-in">
                <p className="font-mono text-xs text-dim">{desktopEntry.category}</p>
                <h2 className="mt-2 max-w-[24ch] text-[28px] font-medium leading-[1.15] tracking-[-0.03em]">
                  {desktopEntry.item.q}
                </h2>
                <div className="mt-4 max-w-[56ch] text-[15.5px] leading-relaxed text-muted [&_a]:text-foreground">
                  {desktopEntry.item.a}
                </div>
              </article>
            )}
          </section>
        </div>
      </main>

      <Footer absolute={false} />
    </div>
  );
}
