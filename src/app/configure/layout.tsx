import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Configure Stremio Letterboxd Addon",
  description:
    "Configure the Stremio Letterboxd addon, connect your account, choose watchlist and custom catalogs, and generate your install URL.",
  alternates: {
    canonical: "/configure",
  },
  openGraph: {
    title: "Configure Stremio Letterboxd Addon",
    description:
      "Set up your Letterboxd watchlist, ratings, and lists in Stremio with a personalized addon configuration.",
    url: "https://stremboxd.com/configure",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Configure Stremio Letterboxd Addon",
    description: "Generate your personalized Letterboxd to Stremio addon manifest URL.",
  },
};

export default function ConfigureLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
