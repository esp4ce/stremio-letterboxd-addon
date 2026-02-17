import TransitionLink from "./components/TransitionLink";

const FEATURES = [
  "Watchlist & diary",
  "Private lists",
  "Friends activity",
  "Ratings on every film",
  "Rate & like from Stremio",
  "Toggle watched & watchlist",
  "All platforms",
  "Letterboxd links",
];

const softwareApplicationSchema = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Stremio Letterboxd Addon",
  applicationCategory: "MultimediaApplication",
  applicationSubCategory: "Movie Metadata Addon",
  operatingSystem: "Stremio",
  url: "https://stremboxd.com",
  description:
    "A Stremio movie metadata addon that syncs Letterboxd watchlist, ratings, diary, liked films, and custom lists.",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
  },
};

const faqSchema = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    {
      "@type": "Question",
      name: "How do I sync Letterboxd to Stremio?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Open the Stremio Letterboxd addon configuration page, connect your Letterboxd account or username, choose catalogs and lists, then install the generated addon manifest in Stremio.",
      },
    },
    {
      "@type": "Question",
      name: "Can I import my Letterboxd watchlist into Stremio?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Yes. The addon can include your Letterboxd watchlist as a Stremio catalog so you can browse it directly in your Stremio library.",
      },
    },
    {
      "@type": "Question",
      name: "Does the addon show Letterboxd ratings in Stremio?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Yes. You can enable rating display so films in Stremio include your Letterboxd rating context.",
      },
    },
  ],
};

export default function Home() {
  return (
    <main className="fixed inset-0 flex h-[100dvh] w-screen cursor-default flex-col bg-[#0a0a0a] text-white sm:h-screen sm:items-center sm:justify-center">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareApplicationSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />

      <section className="flex min-h-0 flex-1 w-full max-w-7xl flex-col items-center justify-center overflow-y-auto px-4 sm:mx-auto sm:-mt-16 sm:flex-none sm:h-full sm:overflow-visible">
        <h1 className="mt-10 text-center text-2xl font-semibold tracking-tight text-white sm:mt-0 sm:text-5xl lg:text-6xl xl:text-7xl">
          Letterboxd → Stremio Addon
        </h1>

        <p className="mt-4 text-center text-xl font-light text-zinc-400 sm:mt-6 sm:text-2xl">
          Unofficial addon
        </p>

        <p className="mx-auto mt-4 max-w-3xl text-center text-lg font-light leading-relaxed text-zinc-300 sm:mt-8 sm:text-2xl">
          This addon syncs your Letterboxd data into Stremio.
        </p>

        <div className="mx-auto mt-6 w-full max-w-5xl max-h-[28vh] overflow-y-auto sm:mt-12 sm:max-h-none sm:overflow-visible config-scroll">
          <ul className="mx-auto grid w-full gap-3 sm:gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((feature) => (
              <li
                key={feature}
                className="flex items-center gap-3 rounded-xl bg-zinc-900/50 p-3 sm:p-4"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-sm text-zinc-300">
                  ✓
                </span>
                <span className="text-base font-light text-zinc-200">
                  {feature}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="mt-6 text-center text-sm font-light text-zinc-500 sm:mt-10">
          After installing, use{" "}
          <a
            href="https://stremio-addon-manager.vercel.app/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-zinc-400 underline decoration-zinc-700 underline-offset-2 transition-colors hover:text-zinc-200"
          >
            Stremio Addon Manager
          </a>{" "}
          to prioritize this addon for the best experience.
        </p>
      </section>

      <section aria-label="Stremio Letterboxd addon information" className="sr-only">
        <h2>Sync Letterboxd to Stremio</h2>
        <p>
          Install this Stremio movie metadata addon to sync your Letterboxd watchlist, ratings, liked films, diary, and
          custom lists.
        </p>
        <h2>How to install</h2>
        <ol>
          <li>Open the addon configuration page.</li>
          <li>Connect your Letterboxd account or validate your public username.</li>
          <li>Choose the catalogs and lists you want in Stremio.</li>
          <li>Install the generated manifest in Stremio.</li>
        </ol>
        <h2>Frequently asked questions</h2>
        <h3>How do I sync Letterboxd to Stremio?</h3>
        <p>Use the configuration flow, generate your personal manifest URL, and install it in Stremio.</p>
        <h3>Can I use my Letterboxd watchlist in Stremio?</h3>
        <p>Yes. Enable Watchlist during setup and it appears as a catalog.</p>
        <h3>Can I see Letterboxd ratings in Stremio?</h3>
        <p>Yes. Enable ratings in your addon display options.</p>
        <a href="/configure">Configure the Stremio Letterboxd addon</a>
      </section>

      <div className="shrink-0 flex justify-center py-6 sm:absolute sm:bottom-12">
        <TransitionLink
          href="/configure"
          direction="up"
          className="flex h-12 w-12 items-center justify-center rounded-full bg-white transition-all hover:scale-110 hover:bg-zinc-200 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-[#0a0a0a]"
          ariaLabel="Continue to configuration"
        >
          <svg
            className="h-6 w-6 text-black"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 14l-7 7m0 0l-7-7m7 7V3"
            />
          </svg>
        </TransitionLink>
      </div>
    </main>
  );
}
