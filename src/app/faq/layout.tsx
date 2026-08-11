import type { Metadata } from "next";
import { SECTIONS } from "./data";

export const metadata: Metadata = {
  title: "FAQ",
  description:
    "Answers to common questions about installing and using Stremboxd — the Letterboxd addon for Stremio. Installation, features, troubleshooting, and privacy.",
  alternates: { canonical: "/faq" },
  openGraph: {
    title: "Stremboxd FAQ",
    description:
      "Common questions about installing and using the Letterboxd addon for Stremio.",
    url: "https://stremboxd.com/faq",
  },
};

const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: SECTIONS.flatMap((section) =>
    section.items.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    }))
  ),
};

export default function FAQLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      {children}
    </>
  );
}
