import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Supporter — auto-log Stremio to your Letterboxd diary",
  description:
    "Every film you finish in Stremio lands in your Letterboxd diary. Supporters also get auto-sync to Stremio and Nuvio and a persistent session. Everything else stays free.",
  alternates: { canonical: "/pricing" },
  openGraph: {
    title: "Stremboxd Supporter",
    description: "Every film you finish in Stremio lands in your Letterboxd diary.",
    url: "https://stremboxd.com/pricing",
  },
};

export default function PricingLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
