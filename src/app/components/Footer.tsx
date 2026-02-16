const LINKS = [
  { href: "https://github.com/esp4ce", label: "esp4ce" },
  { href: "https://www.reddit.com/r/StremioAddons/", label: "reddit" },
  { href: "https://buymeacoffee.com/esp4ce", label: "support me" },
];

export default function Footer({ absolute = true }: { absolute?: boolean }) {
  return (
    <footer className={`${absolute ? "absolute bottom-0 left-0 right-0" : ""} py-4`}>
      <div className="text-center text-xs font-light tracking-wide text-zinc-600">
        {LINKS.map((link, index) => (
          <span key={link.href}>
            <a
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-zinc-400"
            >
              {link.label}
            </a>
            {index < LINKS.length - 1 && (
              <span className="mx-3 text-zinc-800">/</span>
            )}
          </span>
        ))}
      </div>
    </footer>
  );
}
