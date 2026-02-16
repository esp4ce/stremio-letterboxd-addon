"use client";

import { useEffect } from "react";

const CONSOLE_STYLES = {
  title: "font-size: 17px; font-weight: 500; color: #71717a; font-family: Inter, sans-serif; font-style: italic;",
  label: "font-size: 13px; font-weight: 400; color: #a1a1aa; font-family: Inter, sans-serif;",
  url: "font-size: 13px; font-weight: 400; color: #fff; font-family: Inter, sans-serif;",
  desc: "font-size: 12px; font-weight: 300; color: #71717a; font-family: Inter, sans-serif;",
  footer: "font-size: 12px; font-weight: 300; color: #71717a; font-family: Inter, sans-serif; font-style: italic;",
};

const CONSOLE_LINKS = [
  { label: "GitHub", url: "https://github.com/esp4ce" },
  { label: "Reddit", url: "https://www.reddit.com/r/StremioAddons/", desc: "(Support & Community)" },
  { label: "Support", url: "https://buymeacoffee.com/esp4ce", desc: "(Buy me a coffee)" },
];

/**
 * Displays styled console message with project links.
 * Rendered client-side only.
 */
export default function ConsoleMessage() {
  useEffect(() => {
    const { title, label, url, desc, footer } = CONSOLE_STYLES;

    console.log("%c ", "font-size: 1px; padding: 10px 0;");
    console.log("%cLetterboxd → Stremio Addon", title);
    console.log("%c ", "font-size: 1px; padding: 5px 0;");

    CONSOLE_LINKS.forEach((link) => {
      const paddedLabel = link.label.padEnd(8);
      if (link.desc) {
        console.log(`%c${paddedLabel} %c→  %c${link.url} %c${link.desc}`, label, desc, url, desc);
      } else {
        console.log(`%c${paddedLabel} %c→  %c${link.url}`, label, desc, url);
      }
    });

    console.log("%c ", "font-size: 1px; padding: 5px 0;");
    console.log("%cThanks for using this addon! 🎬", footer);
    console.log("%c ", "font-size: 1px; padding: 10px 0;");
  }, []);

  return null;
}
