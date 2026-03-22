# 📋 CHANGELOG — Espresso

All notable changes to this project are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

Ideas and work-in-progress for the next releases:

- 📧 **Email delivery** — send the digest as a formatted HTML email at generation time (Postmark / Resend / SMTP)
- 📱 **Telegram bot** — `/add <url>` command to submit links from Telegram, `/digest` to get today's briefing
- 🔔 **Webhooks** — POST the digest JSON to a URL of your choice on publish
- 🗂️ **Multiple channels** — separate feeds for Tech, World, Finance with independent link pools and schedules
- 🔖 **Read-it-later integration** — Pocket, Instapaper, Readwise Reader as link sources
- 🌐 **Browser extension** — one-click save from any page without a bookmarklet
- 📄 **PDF export** — download today's digest as a printable PDF
- 📊 **Reading history** — track which stories you've read, mark favourites
- 🔍 **Digest search** — full-text search across all past digests
- 🌍 **Multilingual summaries** — generate summaries in the user's preferred language
- 🛡️ **Rate limiting** — built-in API rate limiting to protect public deployments

---

## [1.0.0] — 2026-03-22

**Initial release. Everything starts here.**

### 🎉 Added

#### Core Pipeline
- **Content ingestion** — `POST /api/links` accepts single URLs or arrays of URLs; stored in SQLite with submission timestamp and sourceType detection (article, youtube, tiktok, tweet, other)
- **Jina Reader extraction** — all submitted URLs are passed through `https://r.jina.ai/{url}` before AI processing; returns clean LLM-ready markdown with no API key required; works on articles, YouTube transcripts, TikTok captions, paywalled content, Twitter/X threads
- **OG image extraction** — raw HTML is fetched for each URL and `<meta property="og:image">` is parsed; images are contextual and free (no image generation API required)
- **OpenRouter AI pipeline** — single structured API call (using `response_format: json_object`) per daily generation; sends all article previews with their full text to the model and receives back: ranked top 10, 200-word editorial summaries, categories, and a closing quote
- **Model selection** — defaults to `google/gemini-flash-1.5` (fast, cheap, excellent editorial quality); easily swappable in `server/pipeline.ts`
- **72-hour deduplication** — pipeline loads all digest stories from the past 3 days and marks them as `recentlyUsed` in the AI prompt; AI is instructed to avoid repeating them unless critically important breaking news
- **Story swapping** — `PATCH /api/digest/:id/story/:storyId/swap` finds an unused link from the pool, extracts it via Jina, summarizes it via OpenRouter, and replaces the target story in the digest JSON
- **Content caching** — extracted text, title, and OG image are cached back to the link row in SQLite after first extraction; subsequent regenerations don't re-fetch Jina

#### RSS Trend Fallback
- **7 trusted RSS sources** — Reuters, BBC World, The Economist (The World This Week), Financial Times, NYT World, WSJ World, Associated Press; all public RSS feeds, no API keys
- **Automatic gap-filling** — if user has submitted fewer than 10 links, the pipeline fetches trending stories from RSS sources to fill the gap; user-submitted content always has priority
- **72-hour freshness filter** — trend stories older than 72 hours are discarded before being sent to the AI
- **AI priority labelling** — trend items are marked `isTrend: true` in the AI prompt; model is explicitly instructed to strongly prefer user-submitted content
- **Graceful degradation** — if all RSS feeds fail (network issue), the pipeline proceeds with whatever user links are available; only errors if there is truly nothing at all

#### Database
- **SQLite via Drizzle ORM** — zero-infrastructure, file-based, git-friendly; all state lives in a single `espresso.db` file
- **Auto-migration** — `CREATE TABLE IF NOT EXISTS` on server startup; no separate migration command needed
- **Links table** — stores URL, title, OG image, content hash (SHA-256 for dedup), extracted text, sourceType, submission time, processed time, and which digest used it
- **Digests table** — stores date, status (draft/published), full stories JSON array, closing quote, generation time, publish time
- **Config table** — key/value store for OpenRouter key and admin key; UI-configurable at `/#/setup`

#### API
- `GET /api/digest/latest` — returns latest published digest (public)
- `GET /api/digest/:id` — returns any digest by ID (public)
- `GET /api/digests` — returns all digests (admin)
- `POST /api/digest/generate` — triggers full pipeline (admin)
- `POST /api/digest/:id/publish` — publishes a draft (admin)
- `POST /api/digest/:id/unpublish` — reverts to draft (admin)
- `DELETE /api/digest/:id` — deletes a digest (admin)
- `PATCH /api/digest/:id/story/:storyId/swap` — swaps a story (admin)
- `PATCH /api/digest/:id/story/:storyId` — edits story fields manually (admin)
- `PATCH /api/digest/:id/quote` — edits closing quote (admin)
- `POST /api/digest/:id/reorder` — reorders stories (admin)
- `POST /api/links` — submit one or many URLs (admin)
- `GET /api/links` — list all links (admin)
- `DELETE /api/links/:id` — delete a link (admin)
- `GET /api/health` — health check (public)
- `POST /api/setup` — save API keys on first run
- `GET /api/setup/status` — check if configured (public)

#### Admin Protection
- **`x-admin-key` header auth** — if an admin key is configured, all write endpoints require it; public read endpoints remain open
- **First-run flow** — if no key is configured, setup is open; once configured, reconfiguration requires the existing admin key

#### Frontend — Reader (`/`)
- **Card grid** — 3 columns on desktop, 2 on tablet, 1 on mobile; each card shows OG image, story number, category pill, headline, and summary preview
- **Story reader** — click a card to open the full 200-word summary with source link; prev/next navigation between stories
- **Category pills** — colour-coded by category (Technology blue, Science violet, Business amber, Politics red, World emerald, Culture pink, Health teal, Environment green, Sports orange)
- **Closing quote** — displayed after the card grid and at the end of the last story in reader view
- **Loading state** — animated coffee cup icon while digest loads
- **Empty state** — friendly prompt to go set up the admin panel when no digest exists
- **Dark mode** — defaults to system preference; manual toggle in header persists for session

#### Frontend — Admin Panel (`/admin`)
- **3-tab layout** — Overview, Links, Digest
- **Overview tab** — stats (total links, unprocessed, total digests, published), quick Generate button, configuration form (OpenRouter key, admin key), session admin key input
- **Links tab** — single URL input + bulk paste mode (one URL per line); link list with status indicator (amber = unprocessed, green = used in digest), source domain, submission date, delete button
- **Digest tab** — all digests list with expandable story previews; publish/unpublish toggle; per-story swap button; delete button
- **API reference** — inline curl examples for link submission
- **Session key** — admin key stored in React state (not localStorage) for the session; enter once per visit

#### Frontend — Setup (`/setup`)
- **First-run wizard** — OpenRouter key + optional admin key; redirects to admin on save

#### Design
- **Dark editorial palette** — deep ink background (`hsl(220, 20%, 7%)`), warm foreground, amber accent matching The Economist's editorial warmth
- **Cabinet Grotesk** display font (Fontshare) — strong, editorial, distinctive
- **Satoshi** body font (Fontshare) — clean, modern, readable at any size
- **Fluid type scale** — `clamp()`-based sizing; no hardcoded pixel values
- **Full light/dark mode** — CSS custom properties, system preference default

#### Scheduling
- **GitHub Actions workflow** — `.github/workflows/daily-digest.yml`; fires at `0 6 * * *` (6:00 AM GMT); manual trigger via `workflow_dispatch`; optional `AUTO_PUBLISH=true` repo variable
- **Auto-publish step** — if `AUTO_PUBLISH=true`, the workflow fetches the latest digest ID and publishes it automatically after generation

#### Documentation
- **README.md** — full project description, architecture diagram, feature list, stack table, API reference, deployment quick-start
- **INSTALL.md** — complete installation guide for all platforms (Fly.io, Railway, Render, DigitalOcean, VPS, Docker); scheduling setup; link submission methods; security notes; troubleshooting
- **CHANGELOG.md** — this file

---

## Versioning Philosophy

- **MAJOR** (x.0.0) — breaking API changes or complete architectural rewrites
- **MINOR** (1.x.0) — new features, new integrations, new delivery methods
- **PATCH** (1.0.x) — bug fixes, performance improvements, documentation updates

---

*Built with [Perplexity Computer](https://www.perplexity.ai/computer)*
