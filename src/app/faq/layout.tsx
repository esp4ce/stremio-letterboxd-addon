import type { Metadata } from "next";
import { SECTIONS } from "./data";
import { pageMetadata } from "../../lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Stremboxd FAQ: Letterboxd Addon for Stremio & Nuvio",
  description:
    "Answers about the Letterboxd addon for Stremio and Nuvio: install, public or full access, catalogs, poster ratings, Supporter, troubleshooting and privacy.",
  path: "/faq",
});

const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: SECTIONS.flatMap((section) =>
    section.items.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: {
        "@type": "Answer",
        // `a` may be JSX (links inside an answer), which cannot be serialised
        // into structured data — such items carry a plain-text `aText`.
        text: item.aText ?? (typeof item.a === "string" ? item.a : ""),
      },
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
