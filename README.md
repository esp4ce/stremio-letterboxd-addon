<div align="center">

# Stremboxd

**Bring your Letterboxd life into Stremio.**  
Watchlist, diary, friends, lists, ratings — all in one addon.

[![CI](https://github.com/esp4ce/stremio-letterboxd-addon/actions/workflows/ci.yml/badge.svg)](https://github.com/esp4ce/stremio-letterboxd-addon/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
[![Stremio](https://img.shields.io/badge/Stremio-addon-8A05BE?style=flat-square&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0id2hpdGUiIGQ9Ik0xMiAyQzYuNDggMiAyIDYuNDggMiAxMnM0LjQ4IDEwIDEwIDEwIDEwLTQuNDggMTAtMTBTMTcuNTIgMiAxMiAyek0xMCAxNi41di05bDYgNC41LTYgNC41eiIvPjwvc3ZnPg==)](https://stremboxd.com/configure)

[**Configure →**](https://stremboxd.com/configure) · [Website](https://stremboxd.com) · [FAQ](https://stremboxd.com/faq)

<!-- Replace with an actual screenshot or GIF of the addon in Stremio -->
<!-- ![Stremboxd in action](docs/preview.gif) -->

</div>

---

## Features

- **Watchlist** — your full Letterboxd watchlist, always in sync
- **Diary** — recently watched films, pulled straight from your diary
- **Friends activity** — see what people you follow are watching
- **Custom & private lists** — any Letterboxd list by URL or shortlink
- **Ratings on every poster** — your score displayed directly in Stremio
- **Quick actions** — rate, like, and toggle watched without leaving Stremio
- **Genre, decade & sort filters** — narrow down any catalog instantly
- **Search** — find Letterboxd films from the Stremio search bar
- **2FA support** — works with accounts that have two-factor authentication
- **All platforms** — Stremio web, desktop, Android, iOS, TV

## Two modes

| | Public mode | Full mode |
|---|---|---|
| **Setup** | Username only, no login | Login with Letterboxd credentials |
| **Watchlist** | Public watchlist | Public + private |
| **Diary** | — | ✓ |
| **Friends** | — | ✓ |
| **Quick actions** | — | ✓ |
| **Custom lists** | ✓ | ✓ |
| **Popular / Top 250** | ✓ | ✓ |

## Get started

1. Go to [stremboxd.com/configure](https://stremboxd.com/configure)
2. Choose Public or Full mode and configure your preferences
3. Click **Install in Stremio**
4. _(Optional)_ Use [Stremio Addon Manager](https://stremio-addon-manager.vercel.app/) to prioritize the addon for best results

## Stack

| Layer | Tech |
|---|---|
| Frontend | Next.js 16, React 19, Tailwind CSS 4 |
| Backend | Fastify 5, TypeScript, SQLite |
| Auth | JWT (Jose), AES-256-GCM encrypted tokens |
| Tests | Vitest, MSW |

## Support

If you find this useful, consider buying me a coffee.

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-support-yellow?style=flat-square&logo=buy-me-a-coffee&logoColor=white)](https://buymeacoffee.com/esp4ce)

## License

[MIT](LICENSE)
