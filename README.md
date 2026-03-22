# ☕ Espresso (β)

<div align="center">

![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)
![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-07405E?style=for-the-badge&logo=sqlite&logoColor=white)
![License: MIT](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)
![Version](https://img.shields.io/badge/version-1.0.0-brightgreen?style=for-the-badge)
![Self-hosted](https://img.shields.io/badge/self--hosted-one_api_key-blue?style=for-the-badge)

**Your personal AI-powered morning news digest. Self-hosted. One API key. Inspired by The Economist Espresso.**

Feed it links. Wake up to a briefing.

</div>

---

## 👨‍💻 The Story Behind This

I'm **Paul Fleury** — founder, builder, and someone who consumes a lot of internet. I read across Reuters, FT, tech blogs, Substack, YouTube deep-dives, and the occasional TikTok rabbit hole. By the time I've finished my first coffee, I've usually spent 30 minutes just *finding* what's worth reading — and another 30 reading things that weren't.

I wanted something like **The Economist Espresso app** — that compact, curated, editorial morning format — but fed by *my own* content diet rather than a centralized editorial team. Something that:

- Reads everything I've been bookmarking during the week
- Surfaces the 10 most important stories (not 10 most clickable)
- Summarizes each one in 200 sharp words
- Delivers it every morning at 6:00 AM, ready with coffee
- Costs less than one cup per month to run

This project was designed and built **in collaboration with [Perplexity Computer](https://www.perplexity.ai/computer)** — from architecture to implementation, including the AI pipeline design, deduplication logic, RSS fallback system, and the admin panel.

> 💡 If you're an avid reader who wants a curated AI briefing based on *your* sources — not an algorithm's — this is for you.

---

## 🌟 What is this?

**Espresso** is a self-hosted morning digest service. You feed it links — articles, YouTube videos, TikToks, tweets, newsletters, anything with a URL. Every day at 6:00 AM GMT, it:

1. Reads all the content you've submitted (and auto-fills from trusted RSS sources if you haven't submitted enough)
2. Sends everything through an AI pipeline via [OpenRouter](https://openrouter.ai)
3. Selects the 10 most important, distinct stories
4. Writes a 200-word editorial summary for each
5. Finds the OG image for each story
6. Generates an inspiring closing quote
7. Serves a beautiful, Economist-style reader at your domain

You review it in the admin panel, swap any story you don't like, publish — and it's live.

---

## ✨ Features

- **Feed it anything** — articles, YouTube, TikTok, tweets, Reddit, Substack. Any URL works.
- **Smart daily digest** — AI selects the 10 most important, distinct stories
- **Automatic content extraction** — powered by [Jina Reader](https://jina.ai/reader/) (free, no API key needed)
- **RSS trend fallback** — when you haven't submitted enough links, auto-fills from Reuters, BBC, The Economist, FT, NYT, WSJ, AP
- **72-hour deduplication** — same story won't dominate 3 consecutive days
- **Story swapping** — don't like one? swap it for another from your pool with one click
- **Editorial voice** — summaries written in a clear, intelligent, slightly opinionated tone
- **Closing quote** — every edition ends with a curated thought
- **Beautiful reader** — card grid on desktop, swipeable on mobile (React + Tailwind)
- **Dark mode first** — matches system preference, manual toggle
- **Admin panel** — manage links, review drafts, publish, track history
- **REST API** — submit links from anywhere: automations, Shortcuts, bots, scripts
- **One API** — only [OpenRouter](https://openrouter.ai) needed. Zero other paid services.

---

## 🏗️ How It Works (Architecture)

```
Your browser / automation / scripts
       │
       ▼
POST /api/links          ← submit URLs anytime
       │
       ▼
 SQLite DB (links table)  ← stores every URL you've submitted
       │
 ─────────────────────────────────────────────────────
 DAILY GENERATION PIPELINE (6:00 AM GMT)
 ─────────────────────────────────────────────────────
       │
       ├── User has ≥10 links? → use them
       │
       └── User has <10 links? → also fetch from RSS:
               Reuters · BBC · The Economist · FT · NYT · WSJ · AP
               (user links always have priority)
       │
       ▼
Jina Reader (r.jina.ai)   ← extract clean markdown from every URL (free)
       │
       ▼
OpenRouter (LLM)          ← 1 API call:
                              • rank top 10 by newsworthiness
                              • summarize each in ≤200 words
                              • generate a closing quote
       │
       ▼
OG metadata extraction    ← pull hero image from each URL's <meta og:image>
       │
       ▼
SQLite DB (digests table) ← store digest as structured JSON
       │
       ▼
Admin panel review        ← swap stories, edit, approve
       │
       ▼
GET /api/digest/latest    ← serve beautiful reader to the world
```

### Under the Hood

**Content extraction** uses [Jina Reader](https://jina.ai/reader/) — a free public API. Prepend `https://r.jina.ai/` to any URL and get clean, LLM-ready markdown back. Works on paywalled articles, YouTube, TikTok, Twitter/X, PDFs, and more. Zero setup, no API key.

**The AI pipeline** makes a single structured OpenRouter call per daily generation (using `response_format: { type: "json_object" }`). The model receives all article previews, returns the ranked top 10 with summaries and a closing quote in one shot. Clean, cheap, fast.

**Memory = the database**. No vector store, no embeddings, no separate memory service. The SQLite database stores everything: links, extracted text, past digests, used story URLs. Each daily generation is a fresh prompt enriched with the DB's dedup history.

**Images** come from OG metadata (`<meta property="og:image">`) extracted from the source URL's HTML — no image generation API required.

**RSS trend fallback** pulls from 7 trusted sources (Reuters, BBC, The Economist, FT, NYT World, WSJ World, AP) using public RSS feeds. No API keys. Stories older than 72 hours are filtered out. User-submitted content always takes priority.

---

## 🚀 Quick Start

### 1. Clone & Install

```bash
git clone https://github.com/paulfxyz/espresso.git
cd espresso
npm install
```

### 2. Run the dev server

```bash
npm run dev
# → http://localhost:5000
```

### 3. Configure

Visit `http://localhost:5000/#/setup` and enter your OpenRouter API key.

Or set environment variables:

```bash
# .env (optional)
OPENROUTER_KEY=sk-or-v1-...
ADMIN_KEY=your-secret-key    # protect admin panel (optional)
DB_PATH=./espresso.db        # SQLite database path
PORT=5000
```

### 4. Submit some links

```bash
curl -X POST http://localhost:5000/api/links \
  -H "Content-Type: application/json" \
  -H "x-admin-key: your-secret-key" \
  -d '{"url": "https://www.reuters.com/some-article"}'
```

Or use the admin panel at `http://localhost:5000/#/admin`.

### 5. Generate your first digest

Click "Generate Today's Digest" in the admin panel, or:

```bash
curl -X POST http://localhost:5000/api/digest/generate \
  -H "x-admin-key: your-secret-key"
```

Review the stories, swap any you don't like, then publish. Done.

---

## 🛠️ What's in the Box

| File / Folder | Purpose |
|---|---|
| `server/` | Express backend — routes, pipeline, storage, trends |
| `server/pipeline.ts` | The daily generation pipeline (Jina → OpenRouter → digest) |
| `server/trends.ts` | RSS fallback system (Reuters, BBC, Economist, FT, NYT, WSJ, AP) |
| `server/storage.ts` | SQLite storage layer via Drizzle ORM |
| `server/routes.ts` | All API endpoints |
| `client/` | React frontend — digest reader + admin panel |
| `client/src/pages/DigestView.tsx` | The morning reader (public) |
| `client/src/pages/AdminPage.tsx` | Admin panel with 3 tabs: overview, links, digest |
| `client/src/pages/SetupPage.tsx` | First-run setup wizard |
| `shared/schema.ts` | Shared TypeScript types + Drizzle schema |
| `.github/workflows/daily-digest.yml` | GitHub Actions cron — fires at 6:00 AM GMT |
| `INSTALL.md` | Full installation + deployment guide |
| `CHANGELOG.md` | Full version history |

---

## ⏰ Automatic Daily Generation

### Option A: GitHub Actions (recommended)

Already included in `.github/workflows/daily-digest.yml`. Fires at 6:00 AM GMT daily.

Add two secrets to your GitHub repo:
- `ESPRESSO_URL` — your deployed URL (e.g. `https://espresso.yourdomain.com`)
- `ESPRESSO_ADMIN_KEY` — your admin key

Optional: set repo variable `AUTO_PUBLISH=true` to skip manual review and publish automatically.

### Option B: System cron (self-hosted VPS)

```bash
# crontab -e
0 6 * * * curl -s -X POST https://yourdomain.com/api/digest/generate \
  -H "x-admin-key: your-key" >> /var/log/espresso.log 2>&1
```

### Option C: Cloudflare Workers Cron (if deploying to CF Workers)

```toml
# wrangler.toml
[triggers]
crons = ["0 6 * * *"]
```

---

## 📡 API Reference

All write endpoints require `x-admin-key` header if an admin key is configured.

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/digest/latest` | Public | Latest published digest |
| `GET` | `/api/digest/:id` | Public | Single digest by ID |
| `GET` | `/api/digests` | Admin | All digests list |
| `POST` | `/api/digest/generate` | Admin | Trigger pipeline |
| `POST` | `/api/digest/:id/publish` | Admin | Publish a draft |
| `POST` | `/api/digest/:id/unpublish` | Admin | Unpublish |
| `PATCH` | `/api/digest/:id/story/:id/swap` | Admin | Swap story |
| `PATCH` | `/api/digest/:id/story/:id` | Admin | Edit story manually |
| `PATCH` | `/api/digest/:id/quote` | Admin | Edit closing quote |
| `POST` | `/api/digest/:id/reorder` | Admin | Reorder stories |
| `POST` | `/api/links` | Admin | Submit link(s) |
| `GET` | `/api/links` | Admin | List all links |
| `DELETE` | `/api/links/:id` | Admin | Delete a link |
| `GET` | `/api/health` | Public | Health check |
| `POST` | `/api/setup` | — | Save API keys (first run) |
| `GET` | `/api/setup/status` | Public | Check config status |

### Submit links via API

```bash
# Single link
curl -X POST https://yourdomain.com/api/links \
  -H "Content-Type: application/json" \
  -H "x-admin-key: YOUR_KEY" \
  -d '{"url": "https://example.com/article"}'

# Multiple links at once
curl -X POST https://yourdomain.com/api/links \
  -H "Content-Type: application/json" \
  -H "x-admin-key: YOUR_KEY" \
  -d '{"urls": ["https://...", "https://...", "https://..."]}'
```

---

## 🎨 Frontend & Mobile

The reader is built with React + Vite + Tailwind CSS + shadcn/ui. It's fully responsive and mobile-first.

**Want a native mobile app?** The frontend is a standard React SPA — wrapping it in a native shell is straightforward:

- **[Capacitor](https://capacitorjs.com/)** — wrap the built `dist/` folder to ship on iOS + Android
- **[Tauri](https://tauri.app/)** — for a lightweight desktop app
- **[Expo Web](https://docs.expo.dev/)** — if migrating to React Native

The dark-mode-first editorial design translates cleanly to both platforms.

---

## 🔧 Deployment

See [INSTALL.md](./INSTALL.md) for the complete step-by-step deployment guide.

### Quick options:

**Fly.io (easiest)**
```bash
fly launch
fly secrets set OPENROUTER_KEY=sk-or-... ADMIN_KEY=your-key
fly deploy
```

**Railway / Render / DigitalOcean App Platform**
- Build command: `npm run build`
- Start command: `npm start`
- Environment variables: `OPENROUTER_KEY`, `ADMIN_KEY`

**Docker**
```bash
docker build -t espresso .
docker run -p 5000:5000 -e OPENROUTER_KEY=sk-or-... -v ./data:/app/data espresso
```

---

## 🛠️ Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Runtime | Node.js + Express | Runs anywhere, no cold start issues |
| Frontend | React + Vite + Tailwind + shadcn/ui | Fast, beautiful, tree-shakeable |
| Database | SQLite (Drizzle ORM) | Zero infrastructure, file-based, git-friendly |
| AI | OpenRouter | 400+ models, one API, OpenAI-compatible |
| Content extraction | Jina Reader (free) | Works on any URL including paywalls and video |
| Images | OG metadata from source URLs | Zero cost, always contextual |
| Scheduling | GitHub Actions cron | Free, reliable, no extra service |
| RSS fallback | Reuters, BBC, Economist, FT, NYT, WSJ, AP | Trusted global coverage |

---

## 📝 Changelog

> Full changelog: **[CHANGELOG.md](./CHANGELOG.md)**

### 🔖 v1.0.0 — 2026-03-22
- 🎉 Initial release — full pipeline, admin panel, reader, RSS fallback, GitHub Actions cron

---

## 🤝 Contributing

Pull requests welcome! Ideas for improvement:

- Email/Telegram/Slack delivery of the daily digest
- Multiple "channels" (tech, world, science) with separate feeds
- Browser extension to save links without leaving the page
- Read-it-later integration (Pocket, Instapaper, Readwise)
- PWA mode with offline support
- Webhook triggers on publish
- Export to PDF / email newsletter format

1. 🍴 Fork the repo
2. 🌿 Create your branch: `git checkout -b feature/my-improvement`
3. 💾 Commit: `git commit -m 'feat: add amazing feature'`
4. 🚀 Push: `git push origin feature/my-improvement`
5. 📬 Open a Pull Request

---

## 📜 License

MIT — free to use, modify, and distribute. See [`LICENSE`](./LICENSE) for details.

---

## 👤 Author

Made with ❤️ by **Paul Fleury** — designed and built in collaboration with **[Perplexity Computer](https://www.perplexity.ai/computer)**.

- 🌐 Website: **[paulfleury.com](https://paulfleury.com)**
- 🔗 LinkedIn: **[linkedin.com/in/paulfxyz](https://www.linkedin.com/in/paulfxyz/)**
- 🐦 GitHub: **[@paulfxyz](https://github.com/paulfxyz)**
- 📧 Email: **[hello@paulfleury.com](mailto:hello@paulfleury.com)**

---

⭐ **If this saves you time every morning, drop a star — it helps others find it!** ⭐
