import { REDDIT_URL, REPO_URL } from "../../lib/seo";

const LINKS = [
  { href: REPO_URL, label: "GitHub" },
  { href: REDDIT_URL, label: "Reddit" },
];

export default function Footer() {
  return (
    <footer className="border-t border-line py-4">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col px-4 sm:px-6 lg:px-8 gap-3 text-[14px] text-dim sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <p>
            <span translate="no">Stremboxd</span> is an unofficial <span translate="no">Letterboxd</span> addon for{" "}
            <span translate="no">Stremio</span> and <span translate="no">Nuvio</span>. Not affiliated with any of
            them.
          </p>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-2">
          {LINKS.map((link) => (
            <a
              key={link.label}
              href={link.href}
              {...(link.href.startsWith("http")
                ? { target: "_blank", rel: "noopener noreferrer" }
                : {})}
              className="py-1 transition-colors hover:text-foreground"
            >
              {link.label}
            </a>
          ))}
        </nav>
      </div>
    </footer>
  );
}
