# 📋 CHANGELOG — Espresso β

All notable changes documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) · Versioning: [SemVer](https://semver.org/)

---

## [Unreleased] — Planned for v1.0.0

- 📧 **Email delivery** — formatted HTML email at generation time (Postmark / Resend / SMTP)
- 📱 **Telegram bot** — `/add <url>` to submit links, `/digest` to read today's edition
- 🔔 **Webhooks on publish** — POST digest JSON to any URL when published
- 🗂️ **Multiple channels** — separate feeds (Tech, World, Finance) with independent pools
- 🔖 **Read-it-later integration** — Pocket, Instapaper, Readwise Reader as auto-sources
- 🌐 **Browser extension** — one-click save from any page
- 📄 **PDF export** — download digest as printable PDF
- 🔍 **Digest search** — full-text search across past editions
- 🛡️ **Rate limiting** — built-in API protection for public deployments
- 📊 **Reading stats** — track which stories you open
- ✅ **Full deployment QA** — tested end-to-end on Fly.io, Railway, VPS
- 📱 **Mobile QA pass** — iOS Safari, Android Chrome
- 🌍 **Multilingual summaries** — generate in user's preferred language

---

## [0.2.0] — 2026-03-22

**Structural release — full internal audit, all bugs fixed, every file documented.**

> No breaking API changes. Safe to pull on an existing deployment.

### 🔍 Audit & Critical Bug Fixes

Ten issues were found during a systematic code review and fixed in this release.
The full audit document is in [`AUDIT.md`](./AUDIT.md).

- **FIXED: Broken image fallback** — `source.unsplash.com` was shut down by Unsplash in
  2023 and returns 404 for all requests. Every story without an OG image had a broken
  image tag. Replaced with `picsum.photos/seed/{hash}/800/450` — deterministic (same URL
  always gets the same image), stable, free, no API key. (Issues #1 and #9)

- **FIXED: Double HTTP fetch per link** — the pipeline called `extractViaJina(url)` and
  then `fetchRaw(url)` a second time just to extract the OG image. Jina already returns
  `Image: https://...` on line 3 of its markdown output. Now parsed directly from the
  Jina response — one less HTTP request per link. (Issue #2)

- **FIXED: `swapStory` stale variable bug** — `oldStory` was captured *after*
  `stories[storyIdx]` was mutated to `newStory`, so `oldLinkId` pointed to the *new*
  story's link, not the old one. The replaced link was never freed back to the unprocessed
  pool. Now captures `oldLinkId` *before* the array mutation. (Issue #4)

- **FIXED: Sequential trend extraction** — trend items were extracted one-by-one in a
  `for` loop. With 20 items at ~5s each = up to 100s worst case. Now uses the same
  `extractAllLinks()` batched parallel function as user links (4 concurrent). (Issue #5)

- **FIXED: No OpenRouter retry** — a single transient 429 or 503 killed the entire
  generation with no recovery. Added one retry with 2s backoff on 429/5xx (not 401).
  Observed ~2% failure rate on first attempt during peak hours in testing. (Issue #6)

- **FIXED: ReDoS risk in RSS XML parser** — `[\s\S]*?` greedy regex on unbounded XML
  can catastrophically backtrack on malformed feeds. Added `MAX_FEED_BYTES = 100,000`
  guard before any regex work, and switched inner tag match from `[\s\S]*?` to `[^<]*`
  (non-crossing — cannot backtrack across tag boundaries). (Issue #7)

- **FIXED: FT and Economist links returning empty** — these feeds use Atom-style
  `<link rel="alternate" href="..."/>` attribute form, not `<link>url</link>` text-node
  form. Our parser only handled the text-node form, so FT and Economist URLs were always
  empty. Added `extractAtomLink()` fallback and `atomStyle: true` flag on affected
  sources. (Issue #10)

- **FIXED: AI `idx` out-of-bounds crash** — if the AI returned an `idx` value outside
  the `allProcessed` array range (occasionally happens when the prompt is truncated),
  it produced silent `undefined` entries in the stories array. Now logs a warning and
  filters null entries with a type guard. (New finding)

- **FIXED: Trend dedup was URL-only** — Reuters and AP frequently publish the same wire
  story under different URLs. URL dedup alone didn't catch this. Added title-prefix
  similarity dedup: normalize title to lowercase, strip punctuation, compare first 60
  chars. (Issue #3)

### ✨ Improvements

- **Trend pool diversity** — stories now interleaved round-robin across sources before
  truncation (1 from Reuters, 1 from BBC, 1 from Economist…). Previously a prolific
  source could fill the entire pool before others were sampled.

- **`X-With-Images-Summary` Jina header** — explicitly requests Jina to include image
  URLs in the response, improving OG image extraction reliability.

- **Jina content stripping** — header block (Title/URL Source/Image lines) is now
  stripped before storing extracted text. AI receives clean article content without
  Jina metadata noise.

- **URL validation on link submission** — `POST /api/links` now validates each URL with
  `new URL()` before inserting. Returns 400 with clear error if no valid URLs.

- **Better HTTP status codes** — `/api/digest/generate` returns 409 Conflict (not 500)
  when today's digest already exists published. Reorder validates storyIds type.

- **`max_tokens: 4096`** added to OpenRouter call — prevents truncated JSON responses
  when processing large article lists.

- **`sourceType` detection expanded** — now detects `reddit` and `substack` URLs in
  addition to youtube/tiktok/tweet.

- **SQLite indexes added** — `idx_links_processed`, `idx_digests_date`,
  `idx_digests_status` — speeds up the 3 most frequent queries at scale.

- **`foreign_keys = ON` SQLite pragma** — good practice for future schema work.

- **`swapStory` now frees old link** — when a story is swapped, the replaced link's
  `processedAt` and `digestId` are reset to null, returning it to the pool for future use.

### 📝 Documentation

- **Every file has a full JSDoc file header** — `@file`, `@author`, `@version`, context
  explanation, design decisions, audit notes
- **Every function has a doc comment** — what it does, why it exists, v0.2.0 changes
- **Inline reasoning throughout** — constants documented with the rationale behind
  chosen values (why `EXTRACTION_BATCH_SIZE=4`, why `MAX_TEXT_PER_ARTICLE=3000`, etc.)
- **`AUDIT.md` added** — documents all 10 issues found in review, with fix status
- **`shared/schema.ts`** — every column has a doc comment explaining lifecycle and use
- **`server/storage.ts`** — IStorage interface documented; SQLite design decision explained
- **`server/routes.ts`** — every endpoint documented with method, auth, body, behaviour

---

## [0.1.0-beta] — 2026-03-22

**First beta release. The pipeline works end-to-end. Deployment QA in progress.**

### 🎉 Added

- Full AI generation pipeline (Jina Reader → OpenRouter → digest)
- RSS trend fallback from 7 trusted sources
- Link submission via admin panel and API
- 72-hour deduplication
- Story swapping, editing, reordering
- SQLite storage via Drizzle ORM (auto-migrates on boot)
- React + Tailwind + shadcn/ui frontend — dark editorial design
- Admin panel with Overview / Links / Digest tabs
- GitHub Actions daily cron at 6:00 AM GMT
- README, INSTALL, CHANGELOG documentation

### 🐛 Fixed (during beta session)

- `PerplexityAttribution` missing `default` export → Vite build failure
- `throwIfResNotOk` throwing on 404/401 → React crash on empty digest state
- `DigestView` crash when `digest` is null — `.stories.length` on undefined
- Trend pipeline erroring instead of using stub text when Jina fails
- Empty `allProcessed` guard checked too early (before trend merge)

---

## Versioning Philosophy

- **MAJOR** (x.0.0) — breaking API changes or architecture rewrites
- **MINOR** (0.x.0) — new features, integrations, delivery methods
- **PATCH** (0.0.x) — bug fixes, performance, docs
- **Pre-release** (x.x.x-beta) — functional but not production-hardened

---

*Built with [Perplexity Computer](https://www.perplexity.ai/computer)*
