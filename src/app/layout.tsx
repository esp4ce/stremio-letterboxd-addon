import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { Analytics } from "@vercel/analytics/react";
import "./globals.css";
import ConsoleMessage from "./components/ConsoleMessage";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["300", "400", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://stremboxd.com"),
  title: {
    default: "Stremio Letterboxd Addon | Sync Watchlist, Ratings & Lists",
    template: "%s | Stremboxd",
  },
  description:
    "Install the Stremio Letterboxd addon to sync your Letterboxd watchlist, ratings, diary, liked films, and custom lists directly into Stremio.",
  keywords: [
    "stremio letterboxd addon",
    "letterboxd watchlist stremio",
    "sync letterboxd to stremio",
    "letterboxd ratings in stremio",
    "stremio movie metadata addon",
    "letterboxd addon",
    "stremio addon",
  ],
  alternates: {
    canonical: "/",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-video-preview": -1,
      "max-snippet": -1,
    },
  },
  openGraph: {
    title: "Stremio Letterboxd Addon | Sync Watchlist, Ratings & Lists",
    description:
      "Connect Letterboxd and Stremio to browse watchlists, ratings, diary entries, and curated lists in one addon.",
    url: "https://stremboxd.com",
    siteName: "Stremboxd",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Stremio Letterboxd Addon",
    description:
      "Sync Letterboxd watchlist, ratings, diary, and lists into Stremio with one addon.",
  },
  authors: [{ name: "esp4ce", url: "https://github.com/esp4ce" }],
  icons: {
    icon: "/favicon.svg",
    apple: "/favicon.svg",
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0a",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${inter.className} antialiased`}>
        <Analytics />
        <ConsoleMessage />
        {children}
      </body>
    </html>
  );
}
