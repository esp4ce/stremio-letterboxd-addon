import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/react";
import "./globals.css";
import ConsoleMessage from "./components/ConsoleMessage";
import PostHogProvider from "./components/PostHogProvider";

const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

const SITE_TITLE = "Stremboxd – Sync Letterboxd with Stremio";
const SITE_DESCRIPTION =
  "Sync your Letterboxd watchlist, ratings, diary and lists with Stremio and Nuvio. Free unofficial addon for all platforms.";

export const metadata: Metadata = {
  metadataBase: new URL("https://stremboxd.com"),
  title: {
    default: `${SITE_TITLE} | Watchlist, Ratings & Lists`,
    template: "%s | Stremboxd",
  },
  description: SITE_DESCRIPTION,
  keywords: [
    "stremboxd",
    "letterboxd",
    "stremio",
    "addon",
    "stremio addon",
    "letterboxd stremio",
    "movies",
    "watchlist",
    "film ratings",
    "diary",
    "sync",
    "streaming",
    "media center",
  ],
  authors: [{ name: "esp4ce", url: "https://github.com/esp4ce" }],
  creator: "esp4ce",
  icons: {
    icon: "/favicon.svg",
    apple: "/favicon.svg",
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://stremboxd.com",
    siteName: "Stremboxd",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f7f8" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
  width: "device-width",
  initialScale: 1,
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Stremboxd",
  applicationCategory: "MultimediaApplication",
  operatingSystem: "All",
  description: SITE_DESCRIPTION,
  url: "https://stremboxd.com",
  offers: [
    { "@type": "Offer", name: "Free", price: "0", priceCurrency: "EUR" },
    {
      "@type": "Offer",
      name: "Supporter",
      price: "9.99",
      priceCurrency: "EUR",
      url: "https://stremboxd.com/#supporter",
      priceSpecification: {
        "@type": "UnitPriceSpecification",
        price: "9.99",
        priceCurrency: "EUR",
        referenceQuantity: { "@type": "QuantitativeValue", value: 1, unitCode: "ANN" },
      },
    },
  ],
  author: {
    "@type": "Person",
    name: "esp4ce",
    url: "https://github.com/esp4ce",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}",
          }}
        />
      </head>
      <body className={`${geist.variable} ${geistMono.variable} antialiased`}>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-control focus:bg-foreground focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-background"
        >
          Skip to content
        </a>
        <Analytics />
        <PostHogProvider>
          <ConsoleMessage />
          {children}
        </PostHogProvider>
      </body>
    </html>
  );
}
