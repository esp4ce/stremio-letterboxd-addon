import type { Metadata } from "next";

export const SITE_URL = "https://stremboxd.com";
export const SITE_NAME = "Stremboxd";
export const REPO_URL = "https://github.com/esp4ce/stremio-letterboxd-addon";
export const REDDIT_URL = "https://www.reddit.com/r/stremboxd/";
export const ADDON_CATALOG_URL = "https://stremio-addons.net/addons/stremboxd";

export const HOME_TITLE = "Letterboxd Addon for Stremio & Nuvio";
export const SITE_DESCRIPTION =
  "Bring your Letterboxd watchlist, diary, friends activity and lists into Stremio and Nuvio. Free unofficial addon with ratings on posters. Set up in a minute.";

export const KEYWORDS = [
  "letterboxd stremio addon",
  "letterboxd addon for stremio",
  "stremio letterboxd",
  "letterboxd nuvio",
  "letterboxd watchlist in stremio",
  "letterboxd diary stremio",
  "stremboxd",
  "stremio addon",
  "nuvio addon",
];

/**
 * Per-page metadata with its own canonical, Open Graph and Twitter blocks, so no page
 * inherits another page's social title. `title` is used as is (no template suffix).
 */
export function pageMetadata({
  title,
  description,
  path,
}: {
  title: string;
  description: string;
  path: string;
}): Metadata {
  const url = `${SITE_URL}${path === "/" ? "" : path}`;
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: path },
    openGraph: { type: "website", url, siteName: SITE_NAME, title, description, locale: "en_US" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export const siteJsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      url: SITE_URL,
      name: SITE_NAME,
      alternateName: ["Stremboxd Letterboxd addon", "Letterboxd addon for Stremio"],
      description: SITE_DESCRIPTION,
      inLanguage: "en",
      publisher: { "@id": `${SITE_URL}/#author` },
    },
    {
      "@type": "Person",
      "@id": `${SITE_URL}/#author`,
      name: "esp4ce",
      url: "https://github.com/esp4ce",
      sameAs: ["https://github.com/esp4ce", REDDIT_URL],
    },
    {
      "@type": "SoftwareApplication",
      "@id": `${SITE_URL}/#app`,
      name: SITE_NAME,
      alternateName: "Stremboxd Letterboxd addon for Stremio and Nuvio",
      url: SITE_URL,
      description: SITE_DESCRIPTION,
      applicationCategory: "MultimediaApplication",
      applicationSubCategory: "Addon for Stremio and Nuvio",
      operatingSystem: "Web, Windows, macOS, Linux, Android, iOS, Android TV",
      isAccessibleForFree: true,
      license: "https://opensource.org/licenses/MIT",
      featureList: [
        "Letterboxd watchlist in Stremio and Nuvio",
        "Letterboxd diary and friends activity",
        "Any public Letterboxd list by URL",
        "Letterboxd ratings on posters",
        "Rate, like and manage films from the film page",
        "Genre, decade and sort filters",
      ],
      softwareHelp: { "@type": "CreativeWork", url: `${SITE_URL}/faq` },
      sameAs: [REPO_URL, REDDIT_URL],
      author: { "@id": `${SITE_URL}/#author` },
      offers: [
        { "@type": "Offer", name: "Free", price: "0", priceCurrency: "EUR", url: `${SITE_URL}/configure` },
        {
          "@type": "Offer",
          name: "Supporter",
          url: `${SITE_URL}/#supporter`,
          priceCurrency: "EUR",
          priceSpecification: {
            "@type": "UnitPriceSpecification",
            price: "9.99",
            priceCurrency: "EUR",
            referenceQuantity: { "@type": "QuantitativeValue", value: 1, unitCode: "ANN" },
          },
        },
        {
          "@type": "Offer",
          name: "Founder",
          url: `${SITE_URL}/#supporter`,
          price: "59",
          priceCurrency: "EUR",
        },
      ],
    },
  ],
};
