# ☕ Espresso

<div align="center">

![Version](https://img.shields.io/badge/version-1.4.0-red?style=for-the-badge)
![Status](https://img.shields.io/badge/status-stable-brightgreen?style=for-the-badge)
![License](https://img.shields.io/badge/license-MIT-green?style=for-the-badge)
![Node.js](https://img.shields.io/badge/Node.js-20+-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![React](https://img.shields.io/badge/React-18-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)
![TypeScript](https://img.shields.io/badge/TypeScript-5-007ACC?style=for-the-badge&logo=typescript&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-3-07405E?style=for-the-badge&logo=sqlite&logoColor=white)
![Fly.io](https://img.shields.io/badge/Deployed_on-Fly.io-7C3AED?style=for-the-badge)
![Self-hosted](https://img.shields.io/badge/self--hosted-one_API_key-blue?style=for-the-badge)

**Your personal AI-powered morning news digest.**
**Self-hosted. One API key. Inspired by The Economist Espresso.**

🔴 **Live:** [app.cupof.news](https://app.cupof.news) · [cupof.news](https://cupof.news) · [app.cupof.news](https://app.cupof.news)

</div>

---

## 👨‍💻 The Story

I'm **Paul Fleury** — a French internet entrepreneur living in Lisbon. I consume a lot of internet. Reuters, FT, tech blogs, Substack, YouTube deep-dives, TikTok rabbit holes. By the time I've had my first coffee I've usually spent 30 minutes just *finding* what's worth reading, and another 30 reading things that weren't.

I wanted something like **The Economist Espresso app** — that compact, curated, authoritative morning format — but fed by *my own* content diet. Something I could throw links into all week and wake up to a proper briefing, beautifully presented, on any device.

This project was designed and built entirely in collaboration with **[Perplexity Computer](https://www.perplexity.ai/computer)** — from architecture to every line of code, through a live debugging session that included a Fly.io app name mismatch, a broken Unsplash API, a stale variable bug in story swapping, and a full editorial redesign from scratch.

---

## 🌟 What It Does

**Espresso** is a self-hosted morning digest service. You feed it URLs — articles, YouTube videos, TikToks, tweets, newsletters, anything. Every day at 6:00 AM GMT, it:

1. Reads everything you've submitted that week
2. Auto-fills from 25 trusted RSS sources if you haven't submitted enough
3. Sends it all to an AI through [OpenRouter](https://openrouter.ai)
4. AI selects the **20 most important, distinct stories**
5. Writes a **200-word editorial summary** for each
6. Pulls the hero image from each story's OG metadata
7. Generates a **closing quote** thematically relevant to the day
8. Saves a draft digest for your review

You open the admin panel, swap any stories you don't like, and publish. Done.

---

## ✨ Features

| Feature | Details |
|---------|---------|
| **20 stories per digest** | AI selects the 20 most important from your pool |
| **Swipeable card reader** | One story per screen — arrows, keyboard, touch swipe |
| **Keyboard navigation** | ← → ↑ ↓ keys work anywhere on the page |
| **25 RSS fallback sources** | Reuters, AP, BBC, FT, Guardian, Economist, NYT, WSJ, Wired, Nature + 15 more |
| **72-hour deduplication** | Same story won't repeat for 3 days |
| **Story swapping** | Replace any story with one from your pool |
| **Admin auth** | Password login, change password, log out |
| **Economist design** | Red/black/white, Cabinet Grotesk + Libre Baskerville, 4px red rule |
| **Dark/light mode** | Follows system preference, manual toggle |
| **REST API** | Submit links from Shortcuts, scripts, bots, anything |
| **One paid service** | OpenRouter only (~$0.02/day at Gemini Flash rates) |
| **Custom domain** | Full HTTPS, runs on your own domain |

---

## 🏗️ Architecture

```
You submit links all week (API or admin panel)
              │
              ▼
     SQLite DB — links table
              │
    ┌─────────┴──────────────────────────────────────┐
    │         DAILY PIPELINE — 6:00 AM GMT            │
    └─────────┬──────────────────────────────────────┘
              │
    ┌─────────▼──────────┐    ┌─────────────────────────┐
    │  User links (≥20)  │    │  RSS fallback (<20 links)│
    │  Always priority   │    │  25 trusted sources      │
    └─────────┬──────────┘    └──────────┬──────────────┘
              └──────────┬───────────────┘
                         │
                         ▼
              Jina Reader (r.jina.ai)
              Free URL→Markdown extraction
              Handles paywalls, YouTube, TikTok
                         │
                         ▼
              OpenRouter — 1 API call
              Model: Gemini 2.0 Flash
              Output: 20 ranked stories
                      + 200-word summaries
                      + closing quote
                         │
                         ▼
              OG image extraction
              (from each URL's <meta og:image>)
                         │
                         ▼
              SQLite — digests table
              Stored as structured JSON
                         │
                         ▼
              Admin review → Publish
                         │
                         ▼
              Public reader at your domain
```

---

## 🧠 Technology Choices — The Why

This section explains every technology decision. If you're learning web development or building something similar, this is where the real education is.

### SQLite over Postgres

The temptation with every new project is to reach for Postgres. We considered it. But Espresso is a single-user personal tool: one digest per day, ~100 links per month, one admin. SQLite is zero-infrastructure (a single file, no process to manage, no connection string), trivially backupable with `cp`, and handles this workload with zero overhead. The entire database is <1MB after months of use.

The key architectural decision: everything talks through an `IStorage` interface. If you ever want to scale to multi-user and need Postgres, you only change `server/storage.ts` — nothing else touches the DB directly.

**Lesson:** choose the simplest database that fits your actual scale, not your imagined future scale.

### OpenRouter over direct OpenAI/Anthropic

We didn't want to be locked to one model provider, and we didn't want to manage multiple API keys. OpenRouter gives access to 400+ models through a single OpenAI-compatible endpoint. The whole pipeline runs on Gemini 2.0 Flash — fast (~10 seconds for 20 stories), cheap (~$0.02/digest), and excellent at editorial summarization. Switching to Claude or GPT-4o is a one-line change.

The single structured API call design matters: instead of one AI call per story (20 calls × $X), we send all articles in one prompt with `response_format: json_object` and get back the full ranked+summarized digest in one shot.

**Lesson:** batch AI calls wherever possible. N separate calls = N× the cost and N× the latency.

### Jina Reader over custom scraping

The original plan was `@mozilla/readability` + `jsdom`. This works for simple articles but breaks on SPAs (TikTok, Twitter/X), fails silently on paywalls, and requires maintaining custom extraction logic per site.

Jina Reader (`https://r.jina.ai/{url}`) is a free public API that returns clean LLM-ready markdown for any URL. It handles YouTube transcripts, TikTok captions, Twitter threads, PDFs, and paywalled content. It also returns the OG image URL in its response header — which eliminated a second HTTP fetch per link (an early performance bug).

The trade-off: dependency on an external free service. For a personal tool, this is fine. For production SaaS, you'd want a fallback.

**Lesson:** don't build what you can use for free, especially for infrastructure concerns.

### RSS Fallback over a News API

We evaluated NewsAPI.org, GDELT, and Bing News Search. All require API keys, have rate limits, and cost money. Public RSS feeds from 25 trusted outlets (Reuters, BBC, FT, Economist, Guardian, NYT, WSJ, AP, Wired, Nature, Bloomberg, Al Jazeera + more) cover the same ground for free.

More importantly: the source list is explicit and inspectable. You know exactly what feeds the AI. No black-box news ranking algorithms.

**Lesson:** transparency over convenience when it comes to content sources.

### Express + Vite over Next.js

Next.js is excellent but adds framework complexity (SSR/SSG decisions, App Router vs Pages Router, server components) that adds cognitive overhead for a project this size. The app is a simple backend API + a React SPA. Express handles routes, Vite serves the frontend with HMR in dev and builds to static files in production. One port, one process, zero framework magic.

The entire server is ~400 lines. The entire frontend is ~5 files. This is intentional.

**Lesson:** framework overhead compounds over time. Choose the simplest thing that works.

### Fly.io over Railway/Render

Three reasons: **persistent volumes** for SQLite (one file that survives restarts and deploys), **no cold starts** on the always-on hobby plan, and **geographic proximity** (Paris CDG region — close to Lisbon). Railway and Render work fine but their free tiers don't offer persistent storage, which means the SQLite database disappears on every redeploy.

One deploy friction we hit: Fly auto-generates a random app name (`app-lively-haze-690`). Our `fly.toml` had a different name. This caused an `app not found` error on every deploy until we read the actual app name from the dashboard. Document your Fly app name.

**Lesson:** read what the platform actually created, not what you think you created.

---

## 🔧 The Bugs We Fixed

A record of real problems found during development — useful if you fork this project.

| Bug | Symptom | Fix |
|-----|---------|-----|
| Dead Unsplash API | Every story without OG image had a broken 404 image | `source.unsplash.com` was shut down in 2023. Replaced with `picsum.photos/seed/{hash}` — deterministic, stable |
| `swapStory` stale ref | Replaced link never freed back to pool | `oldLinkId` was captured *after* array mutation. Fixed: capture before |
| Sequential trend extraction | Pipeline took up to 100s with 20 trends | Items extracted one-by-one in for-loop. Fixed: batched parallel (4 concurrent) |
| No OpenRouter retry | One transient 503 = dead generation | Added single retry with 2s backoff on 429/5xx |
| RSS ReDoS risk | Malformed XML feed could hang parser | `[\s\S]*?` on unbounded XML. Fixed: `MAX_FEED_BYTES` + non-crossing `[^<]*` regex |
| FT/Economist links empty | These feeds use Atom `href=` not text-node | Added `extractAtomLink()` fallback for Atom-style feeds |
| AI idx out-of-bounds | Undefined story entries in digest | AI occasionally returns idx outside array. Added null guard |
| Admin "admin" password | `admin` didn't work on live Fly deploy | Live DB had `espresso-admin` from setup. Reset to `admin`, improved login hint |
| Fly.io app name mismatch | `app not found` on every deploy | Auto-generated name vs fly.toml name. Fixed: read name from dashboard |
| Double HTTP fetch per link | 2× network requests per link for OG image | Jina already returns OG image in its response. Eliminated second fetch |

---

## 🚀 Quick Start

```bash
git clone https://github.com/paulfxyz/cup-of-news.git
cd espresso
npm install
npm run dev
# → http://localhost:5000
```

Visit `http://localhost:5000/#/setup` — enter your [OpenRouter](https://openrouter.ai) API key.

Then `http://localhost:5000/#/admin` — password **`admin`** — click **Generate Today's Digest**.

---

## 🔑 Admin Password

Default: **`admin`**

Change it: Admin panel → red toolbar at top → **"Change password"**

---

## ⏰ Automatic Daily Generation at 6 AM GMT

GitHub Actions cron is included (`.github/workflows/daily-digest.yml`). Add two secrets to your repo:

| Secret | Value |
|--------|-------|
| `ESPRESSO_URL` | `https://news.yourdomain.com` |
| `ESPRESSO_ADMIN_KEY` | Your admin password |

---

## 📡 API Reference

All write endpoints require `x-admin-key: your-password` header.

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/digest/latest` | Public | Latest published digest (20 stories) |
| `GET` | `/api/digest/:id` | Public | Any digest by ID |
| `GET` | `/api/digests` | Admin | All digests list |
| `POST` | `/api/digest/generate` | Admin | Trigger AI pipeline |
| `POST` | `/api/digest/:id/publish` | Admin | Publish a draft |
| `POST` | `/api/digest/:id/unpublish` | Admin | Revert to draft |
| `PATCH` | `/api/digest/:id/story/:id/swap` | Admin | Swap one story |
| `PATCH` | `/api/digest/:id/story/:id` | Admin | Edit story manually |
| `PATCH` | `/api/digest/:id/quote` | Admin | Edit closing quote |
| `POST` | `/api/digest/:id/reorder` | Admin | Reorder stories |
| `POST` | `/api/links` | Admin | Submit URL(s) |
| `GET` | `/api/links` | Admin | List all links |
| `DELETE` | `/api/links/:id` | Admin | Delete a link |
| `POST` | `/api/admin/change-password` | Admin | Change password |
| `GET` | `/api/health` | Public | Health + version check |
| `POST` | `/api/setup` | — | First-run configuration |
| `GET` | `/api/setup/status` | Public | Check if configured |

### Submit links from anywhere

```bash
# Single URL
curl -X POST https://news.yourdomain.com/api/links \
  -H "Content-Type: application/json" \
  -H "x-admin-key: your-password" \
  -d '{"url": "https://example.com/article"}'

# Multiple URLs
curl -X POST https://news.yourdomain.com/api/links \
  -H "Content-Type: application/json" \
  -H "x-admin-key: your-password" \
  -d '{"urls": ["https://...", "https://..."]}'
```

**Apple Shortcuts:** Create a Share Sheet shortcut that POSTs `location.href` to `/api/links`. Share any Safari page directly into Espresso.

**Browser bookmarklet:**
```javascript
javascript:(function(){fetch('https://news.yourdomain.com/api/links',{method:'POST',headers:{'Content-Type':'application/json','x-admin-key':'your-password'},body:JSON.stringify({url:location.href})}).then(()=>alert('☕ Saved to Espresso'));})();
```

---

## 🔧 Deployment

### Fly.io (recommended)

```bash
fly launch                         # creates the app
fly volumes create espresso_data --size 1 --region cdg
fly secrets set \
  OPENROUTER_KEY=sk-or-... \
  ADMIN_KEY=your-password \
  DB_PATH=/data/espresso.db
fly deploy
```

Full guide: [INSTALL.md](./INSTALL.md)

---

## 🗂️ Project Structure

```
espresso/
├── server/
│   ├── index.ts          # Express server entry point
│   ├── routes.ts         # All API endpoints (thin layer, no business logic)
│   ├── pipeline.ts       # Daily digest generation pipeline
│   ├── trends.ts         # 25 RSS sources — fallback content engine
│   ├── storage.ts        # SQLite storage layer (IStorage interface)
│   └── vite.ts           # Vite dev server integration
├── client/src/
│   ├── App.tsx           # Router + providers
│   ├── pages/
│   │   ├── DigestView.tsx    # Public reader (swipeable cards)
│   │   ├── AdminPage.tsx     # Admin panel (3 tabs)
│   │   └── SetupPage.tsx     # First-run wizard
│   ├── components/
│   │   ├── AdminAuth.tsx     # Login gate + change password
│   │   └── ThemeProvider.tsx # Dark/light mode context
│   └── index.css         # Economist design system
├── shared/
│   └── schema.ts         # Drizzle schema + TypeScript types (shared frontend/backend)
├── .github/workflows/
│   └── daily-digest.yml  # 6 AM GMT cron
├── fly.toml              # Fly.io deployment config
├── Dockerfile            # Multi-stage Node.js build
├── INSTALL.md            # Full deployment guide
└── CHANGELOG.md          # Complete version history
```

---

## 🛠️ Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Runtime | Node.js 20 + Express | Runs anywhere, no cold-start surprises, minimal abstraction |
| Frontend | React 18 + Vite + Tailwind CSS + shadcn/ui | Fast builds, great DX, tree-shakeable |
| Database | SQLite via Drizzle ORM | Zero infrastructure, one file, trivially backupable |
| AI | OpenRouter (Gemini 2.0 Flash) | 400+ models, one API key, ~$0.02/digest |
| Content extraction | Jina Reader — free, no key | Handles paywalls, YouTube, TikTok |
| Images | OG metadata from source URLs | Zero cost, always contextual |
| RSS fallback | 25 public feeds, no API key | Transparent, inspectable, free |
| Scheduling | GitHub Actions cron | Free, reliable, zero config |
| Hosting | Fly.io (Paris / CDG) | Persistent SQLite volume, no cold starts |
| Typography | Cabinet Grotesk + Libre Baskerville | Editorial, distinctive, not overexposed |

---

## 📝 Changelog

Full history: **[CHANGELOG.md](./CHANGELOG.md)**

| Version | Date | Highlights |
|---------|------|------------|
| **1.1.0** | 2026-03-23 | 20 stories per digest, full docs rewrite, line height improvements |
| 0.5.2 | 2026-03-23 | Increased line heights |
| 0.5.1 | 2026-03-23 | Quote card cleanup, logo text removed, bigger desktop type |
| 0.5.0 | 2026-03-23 | Keyboard nav, mobile-first type scale, app.cupof.news |
| 0.4.0 | 2026-03-22 | Swipeable card reader, 25 RSS sources, auth fixes |
| 0.3.0 | 2026-03-22 | Economist red/black/white redesign, admin auth |
| 0.2.0 | 2026-03-22 | Full audit — 10 bugs fixed, all code documented |
| 0.1.0-beta | 2026-03-22 | Initial release |

---

## 🗺️ Roadmap — v2.0.0

- 📧 Email delivery — formatted HTML email at 6 AM (Postmark / Resend)
- 📱 Telegram bot — `/add <url>` to submit links, `/digest` to read
- 🔔 Webhooks — POST digest JSON anywhere on publish
- 🗂️ Multiple channels — separate Tech / World / Science feeds
- 🔖 Pocket / Readwise integration — auto-pull saved articles
- 🌐 Browser extension — one-click save from any page
- 📄 PDF export — print-ready digest download
- 🌍 Multilingual summaries — generate in user's preferred language
- 🛡️ Rate limiting — protect public API endpoints
- 👥 Multi-user — teams and shared digests

---

## 🤝 Contributing

Issues, PRs, and feedback all welcome.

```bash
git checkout -b feature/my-thing
git commit -m 'feat: add amazing feature'
git push origin feature/my-thing
# → open a Pull Request
```

---

## 📜 License

MIT — free to use, modify, and distribute.

---

## 👤 Author

Made with ❤️ by **Paul Fleury** — built with **[Perplexity Computer](https://www.perplexity.ai/computer)**

- 🌐 [paulfleury.com](https://paulfleury.com)
- 🔗 [linkedin.com/in/paulfxyz](https://www.linkedin.com/in/paulfxyz/)
- 🐦 [@paulfxyz](https://github.com/paulfxyz)
- 📧 [hello@paulfleury.com](mailto:hello@paulfleury.com)

---

⭐ **If Espresso improves your mornings, a star helps others find it.**
