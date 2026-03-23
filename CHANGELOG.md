# 📋 CHANGELOG — Cup of News

All notable changes documented here.  
Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) · Versioning: [SemVer](https://semver.org/)

---

## [Unreleased] — Roadmap for v2.0.0

- 📧 Email delivery — formatted HTML digest at 6 AM (Postmark / Resend / SMTP)
- 📱 Telegram bot — `/add <url>` to submit links, `/digest` to read
- 🔔 Push notifications — native Capacitor 6 AM alert
- 🗂️ Multiple channels — separate Tech / World / Finance feeds
- 🔖 Pocket / Readwise auto-import
- 🌐 Browser extension — one-click save
- 🛡️ Rate limiting — API protection for public deployments
- 👥 Multi-user — teams and shared digests

---

## [1.6.0] — 2026-03-23

**Multi-source attribution, Gemini 2.5 Pro, diversity mandate v4, RSS header removed.**

### Engineering notes — what broke and what we learned

**The model upgrade: why Gemini 2.5 Pro.**
`google/gemini-2.0-flash-001` is fast and cheap (~$0.02/digest) but struggles with complex
structured instructions: it would ignore the diversity mandate when the news cycle was
dominated by one topic, and its `additionalIdxs` compliance was inconsistent. Gemini 2.5
Pro is more expensive (~$0.08-0.15/digest) but follows multi-constraint instructions
reliably. For a once-a-day task, the cost difference is irrelevant — quality matters more.

First attempt used `google/gemini-2.5-pro-preview-03-25` — that slug doesn't exist on
OpenRouter. The correct slug is `google/gemini-2.5-pro`. The pipeline silently fell back
to the cached digest when the model was unreachable. This exposed a missing validation gap:
`storiesCount: null` in the response should have been an error, not a silent success.

**Multi-source attribution: the design decision.**
Each story in a digest comes from one primary URL. But major news events are covered by
many outlets simultaneously. The previous design stored only `sourceUrl` (one link). This
felt thin for important breaking stories.

The fix: the AI now receives all article previews and can return `additionalIdxs[]` —
up to 2 extra article indices that also covered the same story from different angles.
These are assembled into a `sources[]` array on the `DigestStory` object:
`[{url, title, domain}]` — primary source first, then up to 2 additional.

The Sources modal in the reader now shows all sources numbered 01/02/03, each as a
clickable link. The AI is instructed to use this for major breaking news instead of
listing the same event twice as separate stories.

**Diversity mandate v4 — the hardest prompt engineering in this project.**
After four iterations, the key insight is: *mandatory slots beat caps*. Telling the AI
"max 2 per country" still allows it to fill the remaining slots with loosely related
content from the same region. But "you MUST include 2 Sports, 1 story from sub-Saharan
Africa, 1 from Asia-Pacific" forces active seeking of underrepresented content.

The geographic specificity matters too. "Africa" was being interpreted as "North Africa"
or "Middle East/North Africa" — so we changed it to "SUB-SAHARAN AFRICA". Similarly
"Asia" was including the Middle East, so we changed it to "ASIA-PACIFIC (Japan, India,
China, SE Asia, Australia — NOT Middle East)". Explicit exclusions in geography mandates
are necessary because regional definitions vary.

We also added a pre-finalisation check: "Before submitting, count your stories per
category and region. If you're short on a mandatory slot, remove an over-represented
story and replace it." This self-verification step significantly improves compliance.

**The RSS icon removal.**
The header had a grid icon (story overview) and an RSS icon (sources list). The RSS icon
was confusing — users thought it was a feed URL for the digest itself, not a list of
fallback sources. Removed. The sources list is still accessible via the `SourcesModal`
component but no longer surfaced in the primary navigation. Fewer buttons = less confusion.

### ✨ Changes

- **Model:** `google/gemini-2.0-flash-001` → `google/gemini-2.5-pro` — better complex
  instruction following for diversity rules and structured JSON with additionalIdxs
- **Multi-source:** `DigestStory.sources[]` — up to 3 sources per story  
- **Sources modal:** numbered 01/02/03 source list per story with domain, title, link
- **RSS icon removed** from header — cleaner navigation
- **Line spacing:** `leading-[3.0]` + `word-spacing: 0.05em` + `letter-spacing: 0.015em`
- **Diversity v4:** mandatory 2 Sports, geographic precision (sub-Saharan Africa,
  Asia-Pacific explicit), pre-finalisation self-check instruction
- **Same-event deduplication:** group via additionalIdxs instead of redundant stories

### 🐛 Fixed

- Model slug `gemini-2.5-pro-preview-03-25` doesn't exist on OpenRouter → `gemini-2.5-pro`
- `storiesCount: null` silent failure when model is unreachable should surface as an error

---

## [1.5.1] — 2026-03-23

**Direct OG image fallback, 34 RSS sources, 17/20 real photos per digest.**

### Engineering notes

**The image problem was deeper than expected.**
v1.4.1 introduced `isValidOgImage()` to reject logos and trackers — but this revealed
the real problem: Jina Reader only returns an `Image:` header when the article itself
contains embedded media. For pure wire service articles (AFP, Bloomberg briefs, WSJ
headlines), Jina has nothing to return. Result: 10/20 stories fell back to SVG placeholders.

**The fix: Range-header HTML fetch.**
When Jina returns no image, we fetch the article URL directly with `Range: bytes=0-20000`.
This is the first 20KB of HTML — enough to capture the `<head>` section where
`<meta property="og:image">` and `<meta name="twitter:image">` live, without downloading
the full 200-500KB page. We try og:image first, then twitter:image as fallback.

This brought real photo coverage from 10/20 to **17/20** per digest. The 3 remaining
SVG fallbacks are genuinely image-free articles (text-only posts, wire service alerts).

**Source expansion (25 → 34).**
Diversity rules can only be satisfied if the source pool contains diverse content.
Adding BBC Sport and ESPN directly to the RSS pool ensured sports content was always
available. Japan Times + The Hindu gave us reliable Asia-Pacific. Latin American Herald
Tribune + Merco Press for Latin America. Rest of World for tech from non-Silicon Valley
perspectives. The source list is the most direct lever for improving digest diversity.

### ✨ Changes
- `fetchOgImageDirect()` — 20KB Range fetch as second-pass OG extraction
- 34 RSS sources: +BBC Sport, ESPN, Japan Times, The Hindu, LAHT, Merco Press,
  Rest of World, New Scientist, Stat News

---

## [1.5.0] — 2026-03-23

**Per-story sources modal, paragraph spacing solved, mandatory geographic coverage.**

### Engineering notes

**line-height vs. word-spacing — the CSS confusion.**
Multiple users reported body text feeling too tight despite `leading-[2.4]` (240% line-height).
The issue: Libre Baskerville at `text-lg/xl/2xl` has tight internal font metrics — the
ascenders and descenders eat into the visual line gap. `leading-[2.6]` helped but wasn't
enough alone. The real solution was three properties together:
- `leading-[2.6]` — vertical space between baselines
- `word-spacing: 0.04em` — horizontal space between words  
- `letter-spacing: 0.01em` — horizontal space between characters

Together these create the "airy broadsheet" rhythm that line-height alone can't achieve.
Print typography designers know this — digital developers rarely do.

**Diversity iteration 3.**
v1.4.0: caps per region → 7 Middle East (AI treated different angles as different regions)
v1.4.3: caps per conflict → 5 Middle East (Sports/Culture still absent)
v1.5.0: mandatory slots → Sports guaranteed, Culture guaranteed, 4 geographic regions.
The critical insight: *caps prevent bad behaviour but don't ensure good behaviour.*
Mandatory slots force the AI to actively seek underrepresented content.

### ✨ Changes
- Per-story "Read sources" modal — original article, domain, full article CTA
- `leading-[2.6]` + `word-spacing` + `letter-spacing` body typography
- Mandatory: ≥1 Sports, ≥1 Culture, ≥1 Health/Environment per digest
- Mandatory: ≥1 story each from Africa, Asia, Americas, Europe
- Middle East cap: ≤4 stories per digest

---

## [1.4.x] — 2026-03-23

**Smart images, sources modal, editorial SVG fallbacks, diversity v2.**

### Engineering notes

**Why AI image generation failed.**
Tested `google/gemini-3.1-flash-image-preview` via OpenRouter chat completions endpoint.
The model exists, but `response.choices[0].message.content` returns `null`. OpenRouter
exposes image generation at `/images/generations` but that URL redirects to their website
— it's not a real API endpoint. After 2 hours of testing with different models and
`modalities: ["text","image"]` parameters, concluded: image generation via OpenRouter is
not reliably accessible from the chat completions API.

Decision: ship `generateCategoryImage()` — an inline SVG per category with colour palette,
grid texture, category label, story headline. Instant, zero cost, deterministic (same story
always gets same image), looks intentional. Better than a broken API call.

**The build error: nested template literals.**
The SVG was built using backtick template literals inside another backtick template literal.
esbuild 0.24 fails with "Unterminated string literal" on this pattern. Fix: build the SVG
as `string[]` array then `.join("\n")`. Non-obvious error message for an obvious root cause.

**OG image validator: what "bad" images look like.**
Surveyed 200 articles to build the rejection patterns for `isValidOgImage()`:
- SVG files (`.svg`, `.svg?v=1`) — always logos, never photos
- `bat.bing.com` — Bing tracking pixel (appears as og:image in some feeds)
- `google.com/preferences` — Google analytics pixel
- Path fragments: `/logo`, `/favicon`, `/icon-google`, `/featured-logo`, `/vector/euronews`
- CDN paths containing `icon-192`, `icon-512`, `apple-touch`

The validator is a defence-in-depth measure — the primary fix was `fetchOgImageDirect()`.

---

## [1.3.0] — 2026-03-23

**Editorial Prompt — personalisation layer.**

### Engineering notes

The editorial prompt is stored in the `config` table under key `editorial_prompt`. At
generation time, it's injected into the AI system prompt as "READER PROFILE & EDITORIAL
LENS" — high priority, before the diversity rules.

The 2000 character cap was chosen based on token budget: with 20 article previews at 3000
chars each (60,000 chars total), the system prompt budget is ~8,000 chars. The editorial
prompt gets ~2,000 of those. Beyond that, the model starts truncating its response.

The "How it works" explanation in the admin UI matters. Early testing showed users writing
prompts like "make it interesting" — too vague to influence the model. The example prompt
("I'm a tech entrepreneur in Lisbon...") teaches the correct format: profession + location
+ specific interests + specific exclusions + source preferences.

---

## [1.2.0] — 2026-03-23

**Renamed to Cup of News. PWA. Capacitor. app.cupof.news.**

### Engineering notes

**The Fly.io app name problem.**
The old app `paulflxyz-espresso` was destroyed and `cup-of-news` was created fresh.
The issue: fly.toml must exactly match the app name Fly creates. Fly auto-generates
random names (`app-lively-haze-690`) during UI-based setup. The name mismatch caused
`app not found` errors on every deploy attempt until we read the Fly dashboard carefully.
Lesson: after `fly launch`, always verify the app name with `fly apps list`.

**PWA requirements for iOS.**
iOS Safari requires these specific meta tags for a PWA to feel native:
- `apple-mobile-web-app-capable: yes` — enables full-screen mode
- `apple-mobile-web-app-status-bar-style: black-translucent` — extends under notch
- `apple-touch-icon` — the home screen icon
- `viewport-fit=cover` — fills the notch/dynamic island area
Without all four, the app opens in a Safari frame, not full-screen.

---

## [1.1.0] — 2026-03-23

**20 stories. Complete documentation rewrite.**

### Engineering notes

10→20 story changes: `MIN_LINKS_BEFORE_TRENDS` 10→20, AI prompt "select 20", `max_tokens`
4096→8192 (20 × 200-word summaries = ~4,000 tokens output minimum), `.slice(0,10)`→`.slice(0,20)`.

The `max_tokens` increase was the non-obvious one. Without it, the AI would truncate the
response at story 12-14, returning malformed JSON that failed parsing. The error message
("OpenRouter returned invalid JSON") was misleading — the real issue was truncation.

---

## [1.0.x] — 2026-03-22/23

**Keyboard nav, mobile-first typography, custom domains, patch series.**

### Engineering notes

**Keyboard navigation implementation.**
`useEffect(() => { window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler); }, [digest, goNext, goPrev])` — three things matter:
1. Dependency array must include `goNext`/`goPrev` to prevent stale closures
2. `goNext`/`goPrev` must be wrapped in `useCallback` to prevent infinite re-renders
3. Must check `event.target.tagName` to skip keypresses when user is typing in a form

Missing any of these causes subtle bugs that only appear in edge cases.

**Touch swipe: horizontal vs. vertical detection.**
First implementation used only X delta with a 50px threshold. Problem: users swiping
diagonally while scrolling would accidentally trigger story navigation. Fix: track both
X and Y on `touchStart`, only fire swipe if `|dx| > |dy| AND |dx| > 50`. This respects
the user's primary intent (scroll vs. swipe).

---

## [0.2.0] — 2026-03-22

**Internal audit. 10 bugs fixed. Full code documentation.**

Complete bug table with root causes — see README.md.

Key finding: the Unsplash API shutdown (#1) was invisible in production because broken
`<img>` tags are silent failures. Always validate that image URLs return 200 before
treating them as valid. `isValidOgImage()` was born from this audit.

---

## [0.1.0-beta] — 2026-03-22

**Initial release. Pipeline working end-to-end.**

Built in one session with Perplexity Computer. Architecture was correct from day one:
SQLite, Jina, OpenRouter, RSS. Bugs were in the details. First generation: 10 stories
in 10 seconds. The single-call design worked exactly as intended.

---

## Versioning

- **MAJOR** (x.0.0) — breaking API changes, complete rewrites
- **MINOR** (x.x.0) — new features, integrations, UX improvements
- **PATCH** (x.x.x) — bug fixes, performance, docs

---
*Built with [Perplexity Computer](https://www.perplexity.ai/computer)*
