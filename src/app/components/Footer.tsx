const REPO_URL = "https://github.com/esp4ce/stremio-letterboxd-addons";

const LINKS = [
  { href: REPO_URL, label: "GitHub" },
  { href: "https://www.reddit.com/r/stremboxd/", label: "Reddit" },
];

export default function Footer({ absolute = true, help = false }: { absolute?: boolean; help?: boolean }) {
  return (
    <footer
      className={`${absolute ? "absolute bottom-0 left-0 right-0" : ""} border-t border-line py-4`}
    >
      <div className="mx-auto flex w-full max-w-[1600px] flex-col px-4 sm:px-6 lg:px-8 gap-3 text-[13px] text-dim sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          {help && (
            <p>
              Still have questions?{" "}
              <a
                href={`${REPO_URL}/issues/new`}
                target="_blank"
                rel="noopener noreferrer"
                className="link-quiet"
              >
                Open an issue on GitHub
              </a>
              .
            </p>
          )}
          <p>
            Unofficial. Not affiliated with{" "}
            <span translate="no">Letterboxd</span>, <span translate="no">Stremio</span> or{" "}
            <span translate="no">Nuvio</span>.
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
