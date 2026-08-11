import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Configure",
  description:
    "Set up your personalized Stremboxd addon in seconds. Enter your Letterboxd username, pick your catalogs — watchlist, diary, liked films, custom lists — and install directly into Stremio.",
  alternates: { canonical: "/configure" },
  openGraph: {
    title: "Configure Your Stremboxd Addon",
    description:
      "Set up your Letterboxd + Stremio integration. Pick your catalogs, enable ratings, add custom lists, and install in one click.",
    url: "https://stremboxd.com/configure",
  },
};

export default function ConfigureLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
