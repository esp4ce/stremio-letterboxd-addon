export interface FAQItem {
  q: string;
  a: string;
}

export const SECTIONS: { title: string; items: FAQItem[] }[] = [
  {
    title: "Getting started",
    items: [
      {
        q: "How do I install the addon?",
        a: "Enter your Letterboxd username on the configure page, pick your catalogs, and click Install. Stremio opens and adds it automatically.",
      },
      {
        q: "Do I need a password?",
        a: "No. Without a password the addon is stateless — your preferences are encoded in the URL and you get watchlist, liked films, popular, Top 250, and any public list. With your password the addon runs in full mode: your config is stored server-side and you unlock diary, friends activity, and actions (rate, like, add to watchlist). Changing settings without a password requires reinstalling the addon.",
      },
      {
        q: "Is my password stored?",
        a: "Never. It's used once to get a session token. Only an encrypted token is kept.",
      },
      {
        q: "Does it work on mobile?",
        a: "Yes, on any platform that runs Stremio. Some actions may behave differently depending on the app.",
      },
      {
        q: "Do I need a Stremio account?",
        a: "No. You can install and use the addon without a Stremio account. A Stremio account is only required if you want your installed addons and watch history to sync across multiple devices.",
      },
      {
        q: "Where do I find my Letterboxd username?",
        a: "It's in your Letterboxd profile URL: letterboxd.com/username.",
      },
    ],
  },
  {
    title: "Features",
    items: [
      {
        q: "What catalogs are available?",
        a: "Depending on your setup, you get up to eight catalog types: Watchlist (films you want to see), Diary (your recently logged films), Liked Films (films you hearted), Friends Activity (what people you follow are watching), Popular This Week (trending on Letterboxd), Top 250 Narrative Features (Letterboxd's all-time chart), Recommendations (personalised picks — see below), and any custom lists you add. You can enable or disable each one individually.",
      },
      {
        q: "What is the Watchlist catalog?",
        a: "Your personal Letterboxd watchlist — the films you've marked to watch later. It must be set to Public in your Letterboxd privacy settings for the addon to read it.",
      },
      {
        q: "What is the Diary catalog?",
        a: "Your most recently logged films on Letterboxd, in reverse chronological order (latest first). It reflects what you've watched and recorded, not your full watched history.",
      },
      {
        q: "What is the Liked Films catalog?",
        a: "All the films you've given a heart (liked) on Letterboxd, sorted by the date you liked them.",
      },
      {
        q: "What is the Friends Activity catalog?",
        a: "A live feed of films your Letterboxd follows have recently logged. It mirrors the activity stream you see when you're logged in on Letterboxd. Requires a logged-in session.",
      },
      {
        q: "What is Popular This Week?",
        a: "The films that are generating the most activity on Letterboxd right now — logs, likes, and reviews combined. It updates every 24 hours and can be filtered by genre or decade.",
      },
      {
        q: "What is Top 250 Narrative Features?",
        a: "Letterboxd's official chart of the 250 highest-rated narrative feature films, weighted by number of ratings. Updated periodically by Letterboxd.",
      },
      {
        q: "How does the Recommendations catalog work?",
        a: "It analyses up to 80 of your highest-rated and liked films, queries TMDB for films similar to each one, then aggregates the results weighted by how much you liked each seed film (5★ seeds count twice as much as 3★ seeds). Films already on your watchlist or in your watched history are excluded. The result is a ranked list of films you're likely to enjoy but haven't seen yet. Requires a logged-in session.",
      },
      {
        q: "What are poster ratings?",
        a: "Community ratings from Letterboxd displayed as a star overlay on each film poster. Toggle it on or off in the configuration. It has no effect on how catalogs are sorted.",
      },
      {
        q: "How do I add a custom list?",
        a: "Paste any Letterboxd list URL in the configuration (e.g. letterboxd.com/user/list/slug). It works for your own lists and any public list from any user.",
      },
      {
        q: "How do actions work?",
        a: "When logged in, an Actions section appears on each film's page in Stremio. It shows your current relationship with the film (rating, liked status, watchlist status) and lets you rate it, like it, or add/remove it from your watchlist. Best used on Stremio desktop.",
      },
      {
        q: "What sort options are available inside a catalog?",
        a: "Every catalog supports filtering by genre (Action, Comedy, Drama… 30+ genres) and by decade (1920s through 2020s). Most catalogs also support sorting by: Recently Added, Oldest Added, Film Name, Release Date (newest or oldest), Average Rating (high or low), Popularity, Popularity This Week, Popularity This Month, Shortest, and Longest. Logged-in users additionally get Your Rating (high or low) and the Not Watched filter.",
      },
      {
        q: "What are sort variants and how do I add them?",
        a: "Sort variants create a separate, always-on catalog pre-set to a specific mode. There are three: Shuffle (random order every time — great for decision fatigue), Not Watched (your watchlist or a custom list filtered to films you haven't logged), and Popular (sorted by all-time popularity). In the configuration, expand any catalog and toggle the variants you want. Each active variant appears as its own catalog in Stremio named e.g. \"My Watchlist (Shuffle)\".",
      },
      {
        q: "Can I reorder or rename catalogs?",
        a: "Yes. In the configuration, drag any catalog card to reorder it — the order is reflected in Stremio. Click the pencil icon on any card to rename it. Renaming is cosmetic only and doesn't change what the catalog contains.",
      },
    ],
  },
  {
    title: "Troubleshooting",
    items: [
      {
        q: "My watchlist is empty",
        a: "Your watchlist must be public on Letterboxd. Check your privacy settings at letterboxd.com/settings/privacy.",
      },
      {
        q: "A film is missing",
        a: "The addon maps IMDb IDs to Letterboxd entries. Some obscure or non-English titles may not match. This is a known limitation.",
      },
      {
        q: "I changed my settings but nothing updated",
        a: "Without a password, changes require reinstalling the addon — the config is encoded in the URL so Stremio still uses the old one. When logged in, changes are stored server-side and apply on the next catalog refresh.",
      },
      {
        q: "My diary or friends feed is outdated",
        a: "Personal catalogs are cached for 5 minutes. Restarting Stremio usually forces a refresh.",
      },
      {
        q: "I get a 2FA prompt when logging in",
        a: "Enter the 6-digit code from your authenticator app when asked.",
      },
      {
        q: "Actions are not working",
        a: "Actions open an external link to process the request. If nothing happens, try on Stremio desktop.",
      },
    ],
  },
  {
    title: "Privacy",
    items: [
      {
        q: "Is this addon official?",
        a: "No. This is an unofficial open-source addon, not affiliated with or endorsed by Letterboxd.",
      },
      {
        q: "What data do you store?",
        a: "For logged-in users: username, display name, an encrypted session token, and preferences. Nothing else. Anonymous use is fully stateless.",
      },
      {
        q: "How often does data refresh?",
        a: "Personal catalogs refresh every 5 minutes. Popular and Top 250 update every 24 hours.",
      },
      {
        q: "Is it free?",
        a: "Yes, completely free and open-source.",
      },
    ],
  },
];
