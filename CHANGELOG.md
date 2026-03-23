# 📋 CHANGELOG — Cup of News

All notable changes documented here.  
Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) · Versioning: [SemVer](https://semver.org/)

---

## [Unreleased] — Roadmap for v2.1.0+

- 📧 Email delivery — formatted HTML digest at 6 AM (Postmark / Resend / SMTP)
- 📱 Telegram bot — `/add <url>` to submit links, `/digest` to read
- 🔔 Push notifications — native Capacitor 6 AM alert
- 🗂️ Multiple channels — separate Tech / World / Finance feeds
- 🔖 Pocket / Readwise auto-import
- 🌐 Browser extension — one-click save
- 🛡️ Rate limiting — API protection for public deployments
- 👥 Multi-user — teams and shared digests

---

## [2.0.0] — 2026-03-23

**The Edition System: 8 independent editions in English, French, and German.**

### Engineering notes

**The core design challenge: what IS an “edition”?**
The naive approach would be a UI translation layer — same digest, different language skin. We rejected this because it produces a French “edition” that’s just an Anglo-Saxon digest in translation. Real editions require: (1) language-native RSS sources, (2) AI instructed to write in the target language, (3) regional editorial priorities, (4) independent digest storage.

**Why BCP 47 locale tags (en-WORLD, fr-FR, de-DE) as edition IDs:**
Canada has two editions (English and French). ISO country codes alone can’t differentiate them. BCP 47 (language-REGION) is the correct namespace — it’s the W3C/IETF standard for exactly this. It also maps directly to browser navigator.language for future auto-detection.

**The DB migration challenge:**
The digests table previously used (date) as the unique key — one digest per day. v2.0.0 needed (date, edition) as the composite key. SQLite ALTER TABLE doesn’t support adding constraints, only ADD COLUMN. Solution: add the edition column with DEFAULT ‘en-WORLD’, then use raw SQL for the multi-column WHERE queries instead of Drizzle’s typed WHERE (which has limited AND() ergonomics for this pattern).

**French RSS: the reliability problem:**
French newspaper RSS feeds are significantly less standardised than English. Le Figaro changed RSS URLs in 2022. Libération’s RSS has been intermittent. Strategy: anchor on RFI (Radio France Internationale) and France 24 as primary feeds — both are publicly-funded international broadcasters with professionally maintained RSS. Complement with Le Monde (stable), Les Échos (business), L’Équipe (sport). For French-Canada: Radio-Canada, Le Devoir, La Presse.

**German RSS: the format variety:**
FAZ uses Atom format (atomStyle: true required). Süddeutsche changed URL structure in 2023. Deutsche Welle is the anchor — multiple topical sub-feeds, internationally maintained. Spiegel DE has separate RSS for politics, business, general — we pull all three. Kicker for Bundesliga is essential (football is mandatory for German edition).

**The AI language instruction challenge:**
Initial tests showed the AI mixing languages (French summaries with English headlines). Fix: language instruction placed BEFORE the diversity rules in the system prompt, in both English and the target language (“Write in French / Écrivez en français”). The dual-language instruction significantly improved compliance. Also: category names provided in translated form so the AI outputs “Politique” not “Politics” for the French edition.

**The landing page i18n approach:**
Full page translation in vanilla JS with data-lang attributes — no framework. Three language objects (EN, FR, DE) stored in JS. On language switch: iterate all [data-lang-key] elements and replace textContent. Flag switcher in nav persists to localStorage. Clean, zero-dependency, instant switching.

### ✨ Added

- **8 editions:** en-WORLD, en-US, en-CA, en-GB, fr-FR, fr-CA, de-DE, en-AU
- **`shared/editions.ts`** — edition registry with language instructions, regional focus, category translations
- **Edition-specific RSS sources** — French: RFI, France 24, Le Monde, Le Figaro, L’Équipe, Les Échos, Radio-Canada, Le Devoir; German: DW, Der Spiegel, Süddeutsche, FAZ, Zeit, Handelsblatt, Kicker
- **Flag selector in reader header** — dropdown with language grouping, persisted in localStorage
- **Edition selector in admin panel** — 8 flag buttons, generates digest for selected edition
- **`GET /api/digest/latest?edition=fr-FR`** — edition query param
- **`POST /api/digest/generate` body `{ edition }`** — generates specific edition
- **DB migration** — `digests.edition` column added, existing rows default to `en-WORLD`
- **Landing page** — full FR + DE translations, flag switcher, 8 editions showcase section, v2.0.0
- **Version:** 2.0.0

---

## [1.6.2] — 2026-03-23

**Critical bugfix: missing `Rss` import causing blank white page on app.cupof.news.**

### Engineering notes

**The root cause: Rss icon imported but not declared.**
`DigestView.tsx` uses `<Rss size={13} />` in the `SourcesStoryModal` component —
but `Rss` was never added to the `lucide-react` import destructure. In TypeScript
in dev mode, this would have thrown `Cannot find name 'Rss'` at compile time. But
the production build on Fly was compiled from an earlier state before this line
was added. When users loaded the app, React threw a runtime `ReferenceError` and
the entire component tree crashed to a blank white screen.

This is a class of bug where tree-shaking in Vite + esbuild doesn't catch it at
build time if the identifier resolves as `undefined` (JS) rather than an error.
The component renders fine in development (hot reload catches it) but crashes in
the optimised production bundle.

**Fix:** Added `Rss` to the lucide-react import: `{ Sun, Moon, ArrowUpRight,
ChevronLeft, ChevronRight, LayoutGrid, X, Rss }`.

**Cold-start blank page — eliminated.**
`fly.toml` had `auto_stop_machines = "stop"` which puts the Fly machine to sleep
after inactivity. On first request, the machine takes 1-3 seconds to wake. During
this window, the HTML serves but the JS/CSS assets return 503 or partial responses
— the app renders blank. Fixed by setting `auto_stop_machines = "off"` and
`min_machines_running = 1`. The machine always runs. At `shared-cpu-1x / 256MB`,
this costs ~$2-3/month — worth it for a news app you expect to work every morning.

**Version drift: landing page FTP update was failing silently.**
The landing page at `cupof.news` was still showing `v1.5.1` despite previous
FTP deploys. Root cause: the FTP server has two locations that could serve the
site (`/` root and `/cupof.news/public_html/`). The root `index.html` (the old one)
was taking precedence. Fixed by deploying to both locations and verifying live.

### ✨ Fixed

- **`Rss` import missing from `DigestView.tsx`** — caused blank white page on all
  production loads. The app was completely non-functional.
- **`auto_stop_machines = "stop"` → `"off"`** — eliminates cold-start blank page
  on first daily load
- **`min_machines_running = 0` → `1`** — machine always warm
- **Landing page FTP** — deployed to both FTP paths, confirmed `v1.6.2` live
- **Version 1.6.2** across routes.ts, README badge, CHANGELOG, landing page

---

## [1.6.1] — 2026-03-23

**Docs, model references, and version sync patch.**

### Engineering notes

**The version drift problem.**
After every feature release, three surfaces need to stay in sync: the GitHub repo
(version badge + CHANGELOG), the landing page (`cupof.news` — deployed via FTP),
and the API health endpoint (`/api/health` → `version`). v1.6.0 shipped with the
landing page still showing `v1.6.0` while the repo and API had moved to `1.6.1`.
Root cause: FTP deploy was separate from Git deploy, and the landing page was
updated manually each time — easy to forget.

**The INSTALL.md model stale reference.**
`INSTALL.md` was still documenting `google/gemini-2.0-flash-001` as the default
model after v1.6.0 upgraded to `google/gemini-2.5-pro`. Any new developer reading
the install guide would configure the wrong model. Fixed with accurate model table
and explicit warning about the non-existent `gemini-2.5-pro-preview-03-25` slug.

**The README architecture diagram.**
The pipeline ASCII diagram still said `Gemini 2.0 Flash (~$0.02/digest)` — the old
model. Stack table had the same stale reference. Both updated to `Gemini 2.5 Pro`.

### ✨ Changes

- **Landing page:** version badge `v1.6.0` → `v1.6.1` at hero and footer
- **INSTALL.md:** default model updated to `google/gemini-2.5-pro` throughout;
  added warning about non-existent preview slug; updated cost estimates;
  added "Why Gemini 2.5 Pro" explanation
- **README:** architecture diagram and stack table updated to `Gemini 2.5 Pro`
- **Docs consistency:** all three surfaces (GitHub, landing, API) now agree on `1.6.1`

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
