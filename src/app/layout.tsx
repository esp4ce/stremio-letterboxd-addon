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
  title: "Letterboxd → Stremio Addon",
  description: "Unofficial addon that syncs your Letterboxd data into Stremio",
  keywords: ["letterboxd", "stremio", "addon", "movies", "watchlist"],
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
      <body className={`${inter.variable} antialiased`}>
        <Analytics />
        <ConsoleMessage />
        {children}
      </body>
    </html>
  );
}
