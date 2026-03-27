# ☕ Cup of News

<div align="center">

![Version](https://img.shields.io/badge/version-3.5.9-red?style=for-the-badge)
![Status](https://img.shields.io/badge/status-stable-brightgreen?style=for-the-badge)
![License](https://img.shields.io/badge/license-MIT-green?style=for-the-badge)
![Node.js](https://img.shields.io/badge/Node.js-20+-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![React](https://img.shields.io/badge/React-18-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)
![TypeScript](https://img.shields.io/badge/TypeScript-5-007ACC?style=for-the-badge&logo=typescript&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-3-07405E?style=for-the-badge&logo=sqlite&logoColor=white)
![Fly.io](https://img.shields.io/badge/Deployed-Fly.io-7C3AED?style=for-the-badge)
![PWA](https://img.shields.io/badge/PWA-ready-5A0FC8?style=for-the-badge)
![Capacitor](https://img.shields.io/badge/Capacitor-ready-119EFF?style=for-the-badge)
![OpenRouter](https://img.shields.io/badge/AI-OpenRouter-FF6B35?style=for-the-badge)

**Your personal AI-powered morning news digest.**
**Self-hosted. One API key. 20 curated stories. Every morning at 6 AM.**

🔴 **App:** [app.cupof.news](https://app.cupof.news) · **Landing:** [cupof.news](https://cupof.news)

</div>

---

## 👨‍💻 The Story

I'm **Paul Fleury** — a French internet entrepreneur living in Lisbon. I read Reuters, FT, tech blogs, Substack, YouTube. By the time I've finished my first coffee I've usually spent 30 minutes just *finding* what's worth reading, and another 30 reading things that weren't.

I wanted something like **The Economist Espresso app** — compact, curated, authoritative — but fed by *my own* content diet. Something I throw links into all week and wake up to a proper briefing, beautifully presented on any device.

This project was designed and built entirely in collaboration with **[Perplexity Computer](https://www.perplexity.ai/computer)** — from architecture through every line of code, across a full live development session covering 15+ versions, dozens of bugs, and real-world deployment on Fly.io.

---

## ✨ Features

| Feature | Details |
|---------|---------|
| **20 curated stories** | AI selects the 20 most important, distinct stories |
| **Editorial prompt** | Tell the AI who you are — shapes every digest to your interests |
| **9 Language Editions** | en, fr, de, es, pt, zh, ru, tr, it — each generates independently in its native language |
| **34+ RSS sources per edition** | Reuters, BBC, FT, Economist, NYT, Guardian, Wired, Nature, ESPN, Japan Times, RFI, DW, Le Monde, Der Spiegel, ANSA, BBC Türkçe + more |
| **Mandatory diversity** | Always includes Sport, Culture, Science/Health; covers Africa, Asia, Americas, Europe |
| **Per-story source modal** | "Read sources" on each card shows original article + direct link |
| **Smart OG images** | 5-tier pipeline: OG (2-pass + dimension validation) → AI 5-query Wikimedia → Unsplash → picsum; editorial SVG fallback |
| **Swipeable card reader** | One story per screen; keyboard ← → arrows, touch swipe, grid overview |
| **72h deduplication** | Same story won't repeat for 3 days |
| **Admin auth** | Password login, change password, log out |
| **Editorial prompt** | Full personalisation — AI selects and frames through your lens |
| **PWA-ready** | Installable from browser on iOS/Android |
| **Capacitor-ready** | Native iOS/Android app with one command (`npx cap sync`) |
| **Economist design** | Red/black/white, Cabinet Grotesk + Libre Baskerville |
| **One paid service** | OpenRouter only — ~$0.07/digest at Gemini 2.5 Pro rates |

---

## 🏗️ Architecture

```
You submit links all week (API, admin panel, Safari Share Sheet)
                │
                ▼
       SQLite DB — links table
                │
    ┌───────────┴──────────────────────────────────────────┐
    │           PIPELINE — fires daily at 6:00 AM GMT       │
    └───────────┬──────────────────────────────────────────┘
                │
    ┌───────────▼──────────┐    ┌────────────────────────────┐
    │  User links (≥20)    │    │  34+ RSS sources per edition│
    │  Always priority     │    │  when pool is thin          │
    └───────────┬──────────┘    └───────────┬────────────────┘
                └─────────────┬─────────────┘
                              │
                              ▼
               Jina Reader (r.jina.ai)
               Free URL→Markdown, no API key
               Extracts: text, title, og:image header
                              │
                              ▼ (if no OG image found)
               Direct HTML fetch (20KB Range request)
               Parses og:image + twitter:image meta tags
               Catches AFP, WSJ, Bloomberg, Spiegel
                              │
                              ▼
               OpenRouter — 1 structured API call
               Model: Gemini 2.5 Pro (~$0.07/digest)
               Output: 20 stories ranked + summarised
                       + mandatory coverage enforced
                       + closing quote
                              │
                              ▼
               Image validation + SVG generation
               isValidOgImage() rejects logos/pixels/trackers
               generateCategoryImage() creates styled SVG fallback
                              │
                              ▼
               SQLite — digests table (JSON)
               Admin review → Publish
                              │
                              ▼
               Public reader at app.cupof.news
```

### v3.0.0 Multi-Language Architecture

```
Edition Registry (shared/editions.ts)
  └── 9 language editions, each with:
      ├── BCP 47 locale ID (en-WORLD, fr-FR, de-DE, es-ES, pt-PT, zh-CN, ru-RU, tr-TR, it-IT)
      ├── RSS source set (34+ feeds curated per language/region)
      ├── Native language system prompt
      └── Editorial instructions

Pipeline per edition:
  RSS sources (language-native)
      │
      ▼
  Jina Reader → content extraction
      │
      ▼
  OpenRouter (Gemini 2.5 Pro)
  Prompt: write in [target language], follow [edition] editorial tone
      │
      ▼
  SQLite (edition-aware — one digest per edition per day)
      │
      ▼
  React SPA — EditionSelector.tsx → localStorage persistence
```

---

## 🧠 Technology Choices — The Why

Every technology decision in this project was deliberate. If you're building something similar, this section will save you hours.

### SQLite over Postgres

Tempting to reach for Postgres. We didn't. Cup of News is a single-user personal tool: one digest per day, ~100 links per month, no concurrency. SQLite is a single file (`cup-of-news.db`), zero infrastructure, trivially backupable with `cp`. The entire database stays under 1MB after months of use.

The key design: everything talks through an `IStorage` interface (`server/storage.ts`). If you ever need Postgres for multi-user — change one file, nothing else touches the DB.

**Lesson:** match your database to your actual scale, not your imagined future scale.

### OpenRouter over direct API keys

Didn't want to be locked to one provider or manage multiple keys. OpenRouter gives access to 400+ models through a single OpenAI-compatible endpoint. Default model: `google/gemini-2.0-flash-001` — fast (~15s for 20 stories), cheap (~$0.02/digest), excellent at editorial summarisation. Switching to Claude or GPT-4o is one line change.

Critical design: **one API call per generation**, not one per story. We send all article previews in one structured JSON prompt and get back all 20 stories at once. This is 20× cheaper and 20× faster than the naive approach.

**Lesson:** batch AI calls wherever possible. N separate calls = N× cost and N× latency.

### Jina Reader over custom scraping

Original plan: `@mozilla/readability` + `jsdom`. Works for simple articles, breaks on SPAs, paywalls, YouTube, TikTok. Jina Reader (`https://r.jina.ai/{url}`) handles all of this for free with no API key.

The surprise discovery: Jina also returns `Image: https://...` in its response header — eliminating a second HTML fetch per link. But this only works when Jina itself finds an OG image. For RSS articles where Jina returns no image, we added a second-pass direct HTML fetch (only first 20KB, using `Range: bytes=0-20000`) that parses `og:image` and `twitter:image` meta tags directly. This brought real OG photo coverage from 10/20 to 17/20 stories.

**Lesson:** understand exactly what your dependencies return, and add targeted fallbacks for the gaps.

### RSS Fallback over News APIs

Evaluated NewsAPI.org, GDELT, Bing News Search. All require API keys, rate limits, money. 34 public RSS feeds from trusted outlets cover the same ground for free. More importantly: the source list is explicit and inspectable. You know exactly what feeds the AI.

We deliberately added geographic diversity to the source list: BBC Sport + ESPN (sports), Japan Times + The Hindu (Asia), Latin American Herald Tribune + Merco Press (Latin America), Rest of World (tech from Global South), New Scientist + Stat News (science/health). This directly improved digest diversity because the AI can only select from what it receives.

**Lesson:** the quality of AI output is bounded by the quality and diversity of its inputs.

### The Diversity Problem — Three Iterations

The hardest problem in this project wasn't technical — it was making the AI pick a genuinely broad selection of stories instead of 8 Iran/Israel updates.

**v1.4.0:** "Max 3 stories per geographic region" → still got 7 Middle East stories. The AI treated related stories as different regions.

**v1.4.3:** "Max 2 stories per conflict" → got to 5. Better, but Sports/Culture were still absent.

**v1.5.0:** Mandatory slots. Instead of just caps, we *required* the AI to include ≥1 Sports, ≥1 Culture, ≥1 Health/Environment, and ≥1 story each from Africa, Asia, Americas, Europe. This is far more robust because it forces the AI to actively seek non-dominant content.

**Lesson:** don't just cap bad behaviour — mandate good behaviour.

### Image Generation — The Dead End

We attempted AI image generation via OpenRouter's `google/gemini-3.1-flash-image-preview`. The model exists, but the chat completions API returns `content: null` — image output via the standard endpoint isn't reliably exposed. OpenRouter's `/images/generations` endpoint redirects to their website (not a real API). Rather than ship a broken feature, we implemented `generateCategoryImage()`: an inline SVG per category (Politics=red, Technology=blue, Business=amber, etc.) with grid texture, category label, and story headline. Zero cost, instant, always looks intentional.

**Lesson:** document dead ends. They save the next person hours.

### The Image Pipeline — Four Generations of Iteration

Getting good editorial images for a news digest is surprisingly hard. Here is the full history of what we tried, what failed, and why the current solution works.

#### Generation 1: og:image only (v1.x)

The original approach: read the `og:image` meta tag from each article URL, use it if present.

**Problem:** Half of all publishers don't set `og:image`. Many that do set it to logos, icons, or tracking pixels. No fallback existed — articles with no image got a broken `<img>` element.

**Result:** ~50% of stories had images, 50% were blank.

#### Generation 2: Two-pass OG extraction + SVG category fallback (v2.x – v3.3.6)

**Pass 1 — Jina Reader:** `r.jina.ai/https://article-url` returns Markdown. The first `Image: URL` in the response is usually the article's hero photo.

**Pass 2 — Direct HTML Range fetch:** If Jina returns no image, fetch the first 20KB of the article's HTML directly and parse `<meta property="og:image">`. Works for WSJ, Bloomberg, AFP (Jina doesn't expose their OG).

**Fallback:** Inline SVG per category (Politics=red, Technology=blue, etc.) — zero cost, always looks intentional.

**Validator `isValidOgImage()`:** Rejects SVGs, tracking pixels, favicon/logo patterns.

**Problem:** Still got bad images:
- Portrait crops from NYT (`verticalTwoByThree735` URLs) — tall face shots, not editorial photos
- Logos slipping through the regex validator
- Abstract stories (laws, reports) got category SVGs rather than anything visual

#### Generation 3: AI Wikipedia extraction (v3.3.7)

**Idea:** Ask Gemini Flash to read the story headline and extract the main Wikipedia article title (a person, place, or organisation). Fetch that Wikipedia page's infobox photo.

**Problem:** Too narrow.
- `"Indonesia bans school lunch program"` → AI returns `"Indonesia"` → Wikipedia returns the Indonesian flag
- `"Samsung earnings miss"` → AI returns `"Samsung"` → Wikipedia returns the Samsung logo
- `"New trade tariffs announced"` → AI returns `"NONE"` → falls through to SVG
- AI returned portrait crops even when it found the right person (low-res infobox headshots)

**Result:** Worse than the SVG fallback in 30% of cases.

#### Generation 4: 5-query AI → Wikimedia Commons scoring (v3.4.0)

**Insight:** Instead of asking AI for one precise title, ask it to generate 5 *diverse visual queries* at temperature=0.1 (near-deterministic, consistent).

Query types generated by AI:
1. Named person (full name, role)
2. Specific action or event
3. Location or landmark
4. Subject/object
5. Visual concept or metaphor

For each query, search Wikimedia Commons (`generator=search&gsrsort=relevance`) and collect up to 10 candidates.

**Scoring formula per candidate:**

```
score = ratioScore × 0.5 + sizeScore × 0.3 + sizeBonus × 0.2
```

- `ratioScore` = `1 - |aspectRatio - 16/9| / (16/9)` — proximity to 16:9
- `sizeScore` = `min(width / 1920, 1)` — normalised to max 1920px
- `sizeBonus` = `1` if width ≥ 1200px, else `0`
- Minimum ratio: 1.4 (reject near-square and portrait)
- Hard filters: no flags, no maps, no coats-of-arms, no logos, no SVG, no diagrams

**Result:** 8/8 test stories got real editorial photos. Success rate jumped from ~60% to ~95%.

#### Generation 5: OG dimension validation (v3.4.2)

**Problem:** Even with URL-pattern validation, some OG images are legitimate landscape URLs but portrait crops. Reuters CDN paths like `s1.reutersmedia.net/resources/r/?m=...` contain no portrait hint, but the actual image is 600×800 (ratio 0.75). NYT portrait crops appear at landscape-sounding CDN paths.

**Fix:** Fetch only the first 1KB of the image file (`Range: bytes=0-1023`) and parse dimension headers in-process:
- JPEG: scan SOF markers (0xFF 0xC0–0xCF) for width/height bytes
- PNG: read IHDR chunk at bytes 16–23
- WebP: read VP8 chunk at bytes 26–29

If `width/height < 1.3` or `width < 400px` → reject and fall through to Wikimedia.

**Fail-open design:** Some CDNs (Reuters, AP, AFP) block Range requests with 403. When that happens, `getImageDimensions()` returns `null` and we trust the URL validator. False positives (accepting a portrait) are better than false negatives (rejecting a real landscape) since the Wikimedia fallback is now good quality.

**Cost:** ~200ms per OG image. Only fires after URL validation passes. All 20 checks run in parallel via `Promise.all` — total wall-clock cost is ~200ms, not 20×200ms.

#### Generation 6: object-contain + full-bleed CSS (v3.4.1–v3.4.3)

This generation is purely visual — the image pipeline hadn't changed, but the display was wrong.

**v3.4.1 — object-contain:** Images were rendered with `object-cover` inside a fixed-height card. `object-cover` fills the container by cropping edges — fine for background images, wrong for editorial news photos where cropping removes the subject. Mohamed Salah's photo became a close-up of a crowd behind him. Fix: `object-contain` + `bg-black` for letterboxing.

**v3.4.3 — Full-bleed breakout:** The image was inside `<article className="max-w-2xl mx-auto px-4">`. Even with `w-full`, the image was capped at ~672px and had visible padding on both sides. Fix: negative margin breakout — `-mx-4 sm:-mx-8 lg:-mx-12` — cancels the article's padding exactly, making the image run edge-to-edge. Aspect ratio: `aspect-[16/7]` (wider than 16:9 — more cinematic, less vertical letterbox). Back to `object-cover object-center` — fills the frame, crops symmetrically, no black bars.

**Lesson:** Displaying images correctly is harder than finding them. `object-cover` vs `object-contain`, `max-w` constraint breakout, and `aspect-ratio` all interact in non-obvious ways.

#### Generation 7: Non-English editions getting 0 Wikimedia images (v3.4.6)

This was the most embarrassing failure — discovered by auditing the German edition and finding 15/20 stories with `picsum.photos` fallback images.

**Root cause:** Wikimedia Commons is indexed almost entirely in English. The query generator received German story titles like `"Salahs Abschied von Liverpool"` and generated German queries: `"Mohamed Salah Liverpool Fußball"`. Wikimedia returned 0 results. The pipeline fell silently through to picsum.

This failure mode was invisible in the English edition (where it worked fine), and the German edition was never audited story-by-story until a user reported it.

**Fix — three layers:**

1. **Explicit rule in the prompt:** Rule 1, bolded: `⚠️ ALWAYS write ALL 5 queries in ENGLISH — even if the story title is in French, German, Russian, Chinese`. With worked examples: a German Salah headline → English Wikimedia queries.

2. **sourceTitleHint:** The original RSS source article title is often in English even for non-EN editions (BBC, Reuters, NYT are English even when the DE edition uses them for global stories). This English title is now passed alongside the translated title to the query generator, injected as `"English source title (use this to understand the topic in English)"`.

3. **Non-English story examples in prompt:** Added three full worked examples — a German story, a Russian story, a French story — each showing the correct English output format.

**Result:** DE edition went from 0 Wikimedia images to 15/20 in the next generation. Overall success rate across all 9 editions: 83%.

#### The filename relevance check — a cautionary tale (v3.4.6, then reverted)

During v3.4.6, we added a filename-based relevance check: after Wikimedia returns a candidate, compare words from the search query against the Wikimedia filename. Accept if ratio ≥ 0.2.

**This made things worse, not better.** Within one generation:
- "Meta Google social media addiction" → `Minecraft_Classic_screenshot.jpg` — "meta" appears as a substring in "Minecraft"
- "hot-cold freezing paradox" → `Hot_air_balloon_over_Dresden.jpg` — "hot" matches "hot"
- "insect size evolution" → `Insetti_Melolonta_Vulgaris_sistema_respiratorio.jpg` — Italian "insetti" for "insects"

Substring matching is the wrong tool for semantic relevance. The check was actively *selecting* wrong images rather than filtering them out, because short common words appear as substrings of unrelated longer words.

**Lesson learned:** Naive string matching on filenames is not a proxy for image relevance. The only reliable way to validate image relevance is to look at the image itself — using a vision-capable model. This is the next engineering task.

**What the correct solution looks like:** Pass the image URL to a cheap vision model (`meta-llama/llama-3.2-11b-vision-instruct` at $0.049/M tokens, or `google/gemma-3-12b-it:free`). Ask it: "Is this image appropriate for a story titled X? Score 0–10." Accept images scoring ≥ 6. This adds ~1 API call per story with no-photo, but eliminates Minecraft screenshots next to lawsuit stories. Not yet implemented — the OpenRouter 502 failure during prototyping blocked it.

#### Current summary table

| Version | Method | Success Rate | Notes |
|---------|--------|--------------|-------|
| v1.x | og:image only | ~50% | Missing half of stories |
| v2.x | Jina + direct HTML + SVG fallback | ~80% | SVG looks good, but not editorial photos |
| v3.3.7 | AI → Wikipedia single query | ~60% | Regressed — flags, logos, maps |
| v3.4.0 | AI 5-query → Wikimedia Commons | ~80% | EN good, non-EN broken (queries in wrong language) |
| v3.4.1 | + object-contain (no crop) | ~80% | Visual quality fix — no focal-point cropping |
| v3.4.2 | + OG dimension validation | ~82% | Catches portrait OG with landscape CDN URLs |
| v3.4.3 | + Full-bleed CSS, aspect-[16/7] | ~82% | Images fill the card edge-to-edge |
| v3.4.3 | + gemini-2.5-flash queries | ~82% | Better instruction-following for query gen |
| v3.4.3 | + Wikimedia 1280px thumbs | ~82% | ~10× faster loading (200KB vs 5MB originals) |
| v3.4.6 | + English queries for non-EN editions | ~83% | DE: 0→15, ES: 0→16, TR: 10→15 Wikimedia images |
| future | + Vision model relevance scoring | ~95%+ | The unsolved problem — needs vision API |

---

### Express + Vite over Next.js

Next.js adds SSR/SSG decisions, App Router vs Pages Router, server components — cognitive overhead for a project this size. Our app is a simple backend API + React SPA. Express handles routes, Vite handles the frontend. One port, one process, deployable anywhere Node runs. The entire server is ~400 lines.

### Fly.io over Railway/Render

Three reasons: **persistent volumes** for SQLite (one file that survives deploys), **no cold starts** on the hobby plan, and **Paris region** (CDG — close to Lisbon). Railway and Render work but their free tiers don't offer persistent storage — the database disappears on every redeploy.

One real deployment frustration: Fly auto-generates a random app name during setup (`app-lively-haze-690`). We had `paulflxyz-espresso` in our `fly.toml`. This mismatch caused `app not found` on every deploy attempt until we inspected the dashboard. **Always verify the app name Fly actually created.**

---

## 🌍 Language Editions

As of v3.2.8, Cup of News generates natively in **9 languages**. Each edition has its own RSS source set, its own system prompt language, and its own editorial identity. The principle: 1 edition = 1 language.

| Edition | Language | Flag | Key Sources | Notes |
|---------|----------|------|-------------|-------|
| **en** | English | 🌐 | Reuters, BBC, FT, Economist, NYT, Guardian | Global flagship |
| **fr** | Français | 🇫🇷 | Le Monde, RFI, France 24, AFP, Le Figaro | French editorial focus |
| **de** | Deutsch | 🇩🇪 | DW, Spiegel, FAZ, Süddeutsche, Die Zeit | DACH region coverage |
| **es** | Español | 🇪🇸 | El País, EFE, BBC Mundo, La Vanguardia | Spain + Latin America |
| **pt** | Português | 🇧🇷 | Folha, G1, Público, JN, Agencia Brasil | Brazil + Portugal blend |
| **zh** | 中文 | 🇨🇳 | BBC中文, DW中文, RFI中文, 自由亚洲 | Independent outlets only |
| **ru** | Русский | 🇷🇺 | BBCРусская, DWРусская, Meduza, Радио Свобода | Independent outlets only |
| **tr** | Türkçe | 🇹🇷 | BBC Türkçe, DW Türkçe, Bianet, Cumhuriyet, TRT Haber | **NEW v3.2.0** |
| **it** | Italiano | 🇮🇹 | ANSA, Corriere della Sera, La Repubblica, Il Sole 24 Ore | **NEW v3.2.0** |

---

## 🔧 Development Challenges

This section documents the real engineering problems encountered across all versions of Cup of News. If you're forking this project or building something similar, these took hours to solve.

### Unicode Deduplication in Multi-Language RSS Normalization

Deduplication by URL prefix is trivial. Deduplication by title — across 9 languages — is not.

The 72-hour deduplication system originally used a normalized title hash: lowercase, strip punctuation, compare. This works for English. It breaks for Chinese (no word boundaries), Russian (Cyrillic normalization), and Arabic-alphabet languages where the same word has multiple Unicode representations.

The fix: deduplication by URL is always canonical. Title-based dedup only applies within the same script (Latin, Cyrillic, CJK are treated as separate namespaces). This prevents false-positive matches between languages while still catching the real duplicates within a language edition.

**Lesson:** character-level string comparison across Unicode scripts requires explicit script detection, not generic normalization.

### Portuguese: Brazil vs. Portugal — The Single-Edition Decision

Portuguese is spoken by ~260 million people, split between Brazil (215m) and Portugal (10m). The two variants differ in vocabulary, grammar, and available news sources. We considered two separate editions: `pt-BR` and `pt-PT`.

We shipped one: `pt-PT`, European Portuguese.

Reasoning: the RSS source landscape for Brazilian Portuguese is dominated by tabloid content and celebrity news aggregators. Quality Brazilian sources (Folha de S.Paulo, O Globo, Estadão) have paywalls that break Jina Reader's extraction. The European Portuguese quality press (Público, Observador, Expresso) renders cleanly. A single authoritative edition is better than two mediocre ones.

This is a design decision, not a technical limitation. A `pt-BR` edition can be added when a curated source list proves viable.

### Chinese: State Media Exclusion

Building the Chinese RSS source list required an explicit editorial decision: no state media.

Xinhua, People's Daily, CGTN, and China Daily all publish English and Chinese RSS feeds. They are well-maintained and technically functional. We excluded all of them on editorial grounds — they reflect Chinese government positions, not independent journalism.

The independent Chinese-language press landscape is genuinely thin after 2021. We rely on: South China Morning Post (Hong Kong, editorially independent), Taiwan-based publications (Central News Agency, Taiwan News), Radio France Internationale Chinese Service, Voice of America Chinese, and several diaspora outlets.

This means the Chinese edition has a structural bias toward Taiwan and diaspora perspectives. That's documented and intentional. Users who want mainland perspectives should add their own RSS sources.

**Lesson:** source curation is editorial work. The technical choice (which RSS feeds to include) is inseparable from editorial ethics.

### Russian: Post-2022 Media Landscape

Building the Russian edition after February 2022 means navigating a media landscape where most major independent outlets have been shut down, exiled, or blocked inside Russia.

The edition uses exclusively independent outlets operating from exile: Meduza (Latvia), The Insider (Netherlands), iStories (independent investigative), and Novaya Gazeta Europa (EU). All cover Russia from the outside.

State outlets (RT, TASS, Ria Novosti) were excluded on the same grounds as Chinese state media.

The practical consequence: the Russian edition's RSS feed count is lower than other editions, and coverage of events inside Russia depends on exile journalists. This is documented so users understand what they're reading.

### The 8-Edition Collapse to 1-Per-Language Architecture

v2.0.0 shipped 8 editions: en-WORLD, en-US, en-CA, en-GB, fr-FR, fr-CA, de-DE, en-AU. These were all regional variants of 3 languages.

For v3.0.0, we added 4 new native languages (ES, PT, ZH, RU). The choice was: add them as additional regional editions (expanding to 12+), or consolidate to one canonical edition per language.

We chose one canonical edition per new language. Reasons:
- Regional sub-editions require distinct RSS source sets, distinct prompts, and distinct editorial identities. Building `es-MX`, `es-AR`, `es-ES` all properly would require 3× the source curation work.
- Users can add their own regional RSS sources via the link submission API, making the canonical edition flexible.
- The admin generation UI becomes unwieldy above ~10 editions.

The English/French/German regional editions were consolidated. ES, PT, ZH, RU, TR, and IT each get one canonical edition. Total: 9 distinct language editions.

### Dark Mode Default vs. System Preference

The reader defaults to dark mode. This is not the same as "respects system preference."

The implementation: `ThemeProvider.tsx` reads `localStorage('theme')` first. If no preference is stored, it reads `prefers-color-scheme`. If that's `dark`, it sets dark. If `light`, it sets light. If not set (older browsers), it defaults to dark.

The practical effect: on most modern devices, the first visit matches system preference. On devices that don't report a media query preference, they get dark. The rationale: Cup of News is a morning reading app. Most mornings involve low ambient light. Dark mode is the safer default.

The CSS is implemented with `data-theme` attribute on `<html>`, not with `prefers-color-scheme` alone. This allows instant toggle without a CSS transition flash — the attribute change is synchronous with the JS, so no white flash on load.

### v3.2.0: Turkish and Italian RSS Landscape

Adding Turkish required navigating a politically complex media landscape. Post-2016, many independent Turkish outlets moved to online-only distribution with no stable RSS. TRT Haber (state broadcaster) publishes reliable RSS but offers a single editorial voice. The solution: anchor on international public broadcasters (BBC Türkçe, DW Türkçe) as the independent spine, then layer domestic outlets (Cumhuriyet, Bianet, NTV) for local texture. Bianet is the de-facto standard for independent Turkish investigative journalism.

For Italian, the main challenge was ANSA feed selection. ANSA publishes 15+ endpoint URLs but the top-news endpoint rotates only 10 headlines — too thin for 20 stories. The solution: combine 3 ANSA feeds (top news + economia + tecnologia) to build a richer pool. Gazzetta dello Sport covers the non-negotiable calcio sport slot — omitting it would make the Italian edition feel culturally wrong to Italian readers.

### v3.2.0: Hard Reload vs. React Query refetch()

The original logo-click called React Query's `refetch()`. This re-fetched `/api/digest/latest` but didn't reload the JavaScript bundle. During the ~30-second window of a Fly.io zero-downtime deployment, a user who clicked the logo would see "digest refreshed" but still run old code. `window.location.reload()` is the only reliable guarantee the user gets the latest bundle.

The 1250ms spinner before the reload serves two purposes: (1) it makes the click feel intentional rather than accidental, and (2) it gives the `logoSpinning` state time to render the animation before React unmounts. A `disabled={logoSpinning}` guard prevents double-click race conditions.

### v3.2.0: Landing Page Copy Archaeology

The cupof.news landing page had accumulated contradictory version references across 15+ development sessions. The stat counter showed "8" (from v2.0.0's 8-edition era). The editions section heading said "3 World Editions" (from when there were only EN/FR/DE). Body copy in three different sections still referenced the old model. Rather than patching, the entire page was rewritten from scratch with a fresh `grep` audit at the end: zero occurrences of "8 editions", "3 languages", "3 world editions".

### React Query `refetch()` vs. Page Reload for Refresh UX

The "Refresh" button in the public reader has an interesting UX problem: when a new digest is published while the reader is open, how should the app update?

Option A — `window.location.reload()`: simple, guarantees fresh state, but flashes the page white and resets the reader to story 1.

Option B — `queryClient.refetch('digest')`: smooth, keeps the reader position if the digest hasn't changed, but risks stale query cache and requires careful cache invalidation.

We shipped Option B with a twist: `refetch()` is called, and if the returned digest ID differs from the currently-displayed one (i.e., a new digest was published), we reset to story 1. If it's the same digest, the reader stays at the current position. This means hitting refresh mid-read doesn't kick you to story 1 unless there's actually new content.

The edge case: the `staleTime` for digest queries is set to 5 minutes. If you hit refresh within 5 minutes of the last fetch, React Query serves the cache without a network call. This is intentional — the digest doesn't change more than once a day.

### v3.3.x: The 502 Generation Timeout — A Two-Week Saga

This was the most persistent bug in the project's history. The digest generation endpoint returned 502 for weeks before the root cause was finally isolated.

**The symptom:** `POST /api/digest/generate` returned 502 Bad Gateway. Server logs showed the pipeline completing successfully. The digest appeared in the database. But the client always saw 502.

**Red herring #1 — Jina 429 rate limiting:** Jina Reader returned 429 frequently during batch extraction. We added retry logic, exponential backoff, and parallel batching with concurrency limits. The 502s continued.

**Red herring #2 — Node.js keepAliveTimeout:** Fly.io documentation suggested setting `keepAliveTimeout` and `headersTimeout`. We set these on the HTTP server. The 502s continued.

**Red herring #3 — SSE streaming:** We rewrote generation to use Server-Sent Events, streaming progress to the client. The 502s stopped — but we had solved the wrong problem. SSE itself still broke for some users because we used `fetch() + ReadableStream` on the client, which Chrome and Safari buffer in memory before delivering to JavaScript.

**The actual root cause:** Two separate bugs working together.

Bug 1: Fly.io's HTTP proxy drops idle connections after 75 seconds. The pipeline takes 30–250 seconds. The proxy was dropping the connection mid-pipeline, returning 502 to the client even though the server finished successfully.

Bug 2: `fetch()` to OpenRouter had no `AbortController` and no timeout. One slow OpenRouter response (model loading, rate limit backoff) caused the pipeline to hang indefinitely. The 75-second proxy timeout then fired on an already-hung request.

**The fix that actually worked:** Two-step job system. `POST /api/digest/start-job` returns a `jobId` in ~50ms. `GET /api/digest/job/:id/stream` opens a native `EventSource` connection that streams heartbeats every 10 seconds. Each heartbeat resets Fly's 75-second idle timer. The connection stays alive indefinitely. `AbortController(240s)` was added to all OpenRouter calls.

**Lesson:** When debugging distributed system timeouts, draw the full request path on paper first — client → Fly proxy → Node.js → external API. Each hop has its own timeout. The 502 told us nothing about *which* hop failed. Server logs (which showed success) told us the pipeline completed, so the failure was in the proxy layer, not the application.

### v3.3.x: `useRef` for SSE Stale Closures

The SSE streaming UI had a maddening bug: the success handler never fired even though the `done` event arrived.

The cause: React's `useState` setter captures the state value at closure creation time. The `EventSource` `onmessage` handler was created with a reference to the initial `isFinished = false` state. When the `done` event arrived, the closure still held the old `false` value. The `setIsFinished(true)` call was executing, but the `if (!isFinished) { doSuccessAction() }` guard was checking the captured-at-creation value, which was always `false`.

The fix: `useRef` instead of `useState` for the finished flag. `useRef` returns a mutable object whose `.current` property is not subject to closure capture — reading `finishedRef.current` always reads the live value.

```tsx
const finishedRef = useRef(false);
// In EventSource handler:
if (data.type === "done" && !finishedRef.current) {
  finishedRef.current = true;
  // safe to do success action
}
```

**Lesson:** In React, any callback that survives across renders (EventSource handlers, setTimeout, setInterval) will capture stale closure state unless you use `useRef` or the functional update form of `setState`.

### v3.4.x: GitHub Actions Cron Secrets — The Silent Failure

The daily digest cron workflow failed silently for weeks. Every run showed "Cancelled" for 8 editions and "Failed in 2 seconds" for the English edition.

**Root cause:** The `ESPRESSO_ADMIN_KEY` secret was never set in the GitHub repository's Actions secrets. The `ESPRESSO_URL` secret was also missing for the first few runs.

The failure mode was completely silent. GitHub Actions renders missing secrets as empty strings in shell scripts, not as errors. The `curl` command ran with `-H "x-admin-key: "` (empty header) and received a 401. The shell then exited with code 1. GitHub never warned that a referenced secret was undefined.

**Making it worse:** Even after secrets were added, the workflow used `--max-time 120` (120s) for a pipeline that takes 30–250 seconds. When OpenRouter was slow, the curl timed out, returning a 504. This looked identical to the previous failure, obscuring that progress had been made.

**The layered fix:**
1. Set both `ESPRESSO_URL` and `ESPRESSO_ADMIN_KEY` in GitHub → Settings → Secrets → Actions
2. Set `AUTO_PUBLISH=true` as an Actions variable
3. Rewrite the workflow to use `start-job` + polling (no timeout risk — each poll is a fresh 15s HTTP request)
4. Bump `--max-time` to 300s as a safety net

**Lesson:** Always test your CI/CD with a manual `workflow_dispatch` run before relying on scheduled triggers. GitHub Actions will not tell you that a secret is missing — it will just pass an empty string and let the script fail in a way that looks like an application error.

### v3.4.x: Edition Independence — The Invisible Overlap Problem

After building 9 language editions, we assumed they were generating distinct content. They weren't.

Analysis of the French edition's source URLs showed 38% overlap with the English edition. The Italian edition had 45% overlap. Both editions were pulling from the same BBC, Reuters, and NYT wire stories and generating translations rather than culturally distinct journalism.

**Why it happened:** The RSS source pools for non-EN editions included English-language wire services as "global context" sources. When there weren't enough native-language stories to fill 60 candidate articles, the pipeline supplemented with English sources. The AI then chose the biggest stories — which were the English wires — and wrote summaries in the target language. Technically correct, but editorially the Italian reader was getting a translated version of the English digest, not an Italian one.

**The fix:**
1. **Prompt instruction:** Added "EDITION INDEPENDENCE" block for all non-EN editions: "AT LEAST 8 of 20 stories must be on topics not primarily from Anglophone media. AVOID the same major wire stories that would dominate the English edition."
2. **RSS source audit:** Increased the proportion of native-language sources in each edition's pool. Italian edition now has more ANSA, Corriere, Il Post. French has more Le Monde, RFI, France 24.

**Lesson:** You cannot audit edition distinctiveness by looking at the output language. You have to audit the source URL overlap. Two editions writing in different languages about the same Reuters story is not genuine multilingual journalism.

### v3.4.x: The Two-Site Architecture Problem

Cup of News has two separate deployments that look like one product to users:
- `cupof.news` — static HTML landing page on Siteground
- `app.cupof.news` — Node.js application on Fly.io

This architecture is simple and cheap (Siteground shared hosting + Fly.io hobby plan), but it creates a recurring deployment problem: every version bump requires two separate deployments. Forgetting one means the version shown on the landing page (`v3.2.0`) doesn't match the app (`v3.4.6`). We went through this multiple times.

**The version audit checklist we now run for every release:**
- `package.json` version
- `server/routes.ts` health endpoint (`/api/health` version string)
- All `@version` headers in server/*.ts and client/*.tsx
- `landing/index.html` (25+ occurrences — badge, footer, JS comment, all 9 language strings)
- `README.md` badge
- GitHub release tag

**Why not consolidate to one host?** Siteground provides email hosting for `@cupof.news` addresses that would be lost by moving. Fly.io doesn't provide email. The two-host setup is a deliberate trade-off, not an oversight.

**Lesson:** Every time you split a product across two deployment targets, you create a class of bugs that will recur forever — version drift, cache drift, feature drift. Make it impossible to deploy one without the other, or document the checklist and enforce it manually.

### v3.4.x: Cloudflare CDN for a Static Landing Page

The cupof.news landing page is a single 122KB HTML file served from Siteground shared hosting. Adding Cloudflare CDN required understanding the DNS delegation model.

**The ownership chain:**
- Domain registered at: Namecheap
- DNS controlled by: (originally) Siteground nameservers
- Hosting: Siteground shared (cupof.news) + Fly.io (app.cupof.news)

Cloudflare works by replacing the nameservers. You add the domain to Cloudflare, it scans existing DNS records, then you update the nameservers at the registrar (Namecheap) to point to Cloudflare's servers.

**The key mistake to avoid:** Cloudflare's automatic DNS scan sets all A records to "Proxied" (orange cloud) by default. This breaks:
- `app.cupof.news` → must be DNS Only (grey cloud) — Fly.io handles its own TLS and certificate. Proxying through Cloudflare breaks Fly's health checks and certificate validation.
- `ftp.cupof.news` → must be DNS Only — FTP is not HTTP; Cloudflare can't proxy it.
- `mail.cupof.news`, `ssh.cupof.news` → DNS Only — same reason.
- `autoconfig`, `autodiscover` → DNS Only — email client autoconfiguration must resolve directly.

Only `cupof.news` (root) and `www.cupof.news` should be proxied.

**SSL mode:** Set to "Full" (not "Full Strict"). Siteground shared hosting uses a shared certificate that covers `*.siteground.biz` domains, not `cupof.news` directly. "Full Strict" requires a certificate matching the exact hostname — it will fail. "Full" validates that a certificate exists but not that it matches the hostname.

**Lesson:** Before adding a CDN, draw your full DNS chain: registrar → nameservers → A records → origin servers. Understand which services can be proxied (HTTP only) and which need to bypass the proxy entirely.

### Opinion: What I Would Do Differently

After building Cup of News across 25+ versions and 3 weeks of daily use, here is what I would change if starting over:

**1. Use a job queue from day one.** The 502 problem exists entirely because we started with a synchronous HTTP endpoint for a 90-250 second operation. A proper job queue (BullMQ, or even a simple SQLite-backed queue) would have made this architecture obvious from the start. Every long-running operation should be a job, not an HTTP response.

**2. Image quality is a distribution problem, not a search problem.** We spent 5 versions improving the *search* (better queries, better models, better filters). The unsolved problem is that Wikimedia Commons is not a news photo archive — it's a general-purpose media repository. For a news digest, you want Getty Images or AP Photos quality. The correct long-term solution is not better Wikimedia queries; it's a different image source. Paid news photo APIs (AP Content API, Getty Creative API) are expensive ($500+/month) but are genuinely the right product for this use case. The hacky alternative: use the newspaper's own OG image when it's landscape and of sufficient quality (which is already Tier 1 of our pipeline).

**3. Test each edition independently, not just the default English one.** The non-English Wikimedia query failure existed from v3.4.0 but wasn't caught for weeks because we tested in English. Each edition has unique failure modes — language mismatch in queries, weaker native source pools, different AI behaviors for non-Latin scripts. Per-edition regression testing should be part of every generation check.

**4. The editorial prompt is the most underused feature.** The system supports a user-defined editorial prompt that shapes every story selection and framing. In practice, most users set it once and forget it. The digest quality for a finance person who writes "I am a fund manager focused on EM equities" is dramatically better than the generic digest. This feature deserves a first-run onboarding flow, not a buried admin panel setting.

**5. SQLite is the right call — but add WAL mode from day one.** SQLite without WAL mode serializes all writes. On a single-user app with once-daily generation this doesn't matter. But if you ever run parallel edition generation (which we do — 9 editions per day), write contention can cause intermittent failures. `PRAGMA journal_mode=WAL` should be in the initialization script, not something you add later.

---

## 🐛 Bugs Fixed — The Full Record

A complete log of real problems found during development. Useful if you fork this.

| Version | Bug | Symptom | Root Cause | Fix |
|---------|-----|---------|------------|-----|
| 0.2.0 | Dead Unsplash API | Broken images everywhere | `source.unsplash.com` shut down 2023 | → `picsum.photos/seed/{hash}` |
| 0.2.0 | Double HTTP fetch | 2× requests per link for OG image | Jina already returns it; we were fetching again | Parse `Image:` from Jina header |
| 0.2.0 | `swapStory` stale ref | Old link never freed to pool | `oldLinkId` captured *after* array mutation | Capture before mutation |
| 0.2.0 | Sequential trend fetch | Pipeline took 100s+ | `for` loop instead of parallel batches | Batched parallel (4 concurrent) |
| 0.2.0 | No OpenRouter retry | One 503 = dead generation | Zero retry logic | Single retry, 2s backoff |
| 0.2.0 | RSS ReDoS risk | Parser could hang on huge feeds | `[\s\S]*?` on unbounded XML | `MAX_FEED_BYTES` guard + `[^<]*` |
| 0.2.0 | FT/Economist links empty | These sources always returned no URL | Atom `href=` attr not text-node | `extractAtomLink()` fallback |
| 0.3.0 | Admin default password | `admin` didn't work on Fly deploy | Live DB had `espresso-admin` from setup | Reset via API, fix login hint |
| 0.3.0 | Fly app name mismatch | `app not found` on every deploy | Auto-generated name vs fly.toml | Read actual name from dashboard |
| 0.4.0 | AI idx out-of-bounds | Silent undefined stories | AI returns idx outside array range occasionally | Null guard + warning log |
| 1.4.1 | SVG logos as story photos | Euronews/Wired logo as hero image | OG validator didn't exist | `isValidOgImage()` validator |
| 1.5.1 | 50% stories missing images | WSJ, Bloomberg, AFP never had photos | Jina doesn't expose OG for these feeds | Direct HTML Range fetch fallback |
| 3.3.7 | AI Wikipedia single-query regression | Flags, logos, maps instead of photos | AI returned country/brand names as Wikipedia subjects | 5-query approach with Wikimedia Commons scoring (v3.4.0) |
| 3.4.0 | Portrait OG images accepted | Close-cropped face shots despite URL validation | Portrait images with landscape CDN URLs slip through regex | Header byte inspection for actual dimensions (v3.4.6) |
| 3.4.0 | object-cover distorted images | Images cropped at wrong focal point | `object-cover` fills container by cropping edges | `object-contain` + `aspect-video` uniform card height (v3.4.1) |
| 3.2.2 | v3.2.0 deploy never happened | Live site stayed at v3.0.0 | `fly deploy` never run after v3.2.0 | Added deploy to sprint checklist; always run flyctl + FTP |
| 3.3.0 | fetch+ReadableStream SSE buffered | UI frozen 2min then all events arrive | Chrome/Safari buffer fetch response bodies | Native `EventSource` (GET) + job-based two-step API (v3.3.1) |
| 3.3.4 | OpenRouter fetch() no timeout | Pipeline hung forever | `fetch()` with no `AbortController` = infinite wait | 240s AbortController on every OpenRouter call |
| 3.4.0 | Non-EN editions: 0 Wikimedia images | German/French digests got 100% picsum | Wikimedia indexed in English; AI generated queries in story's native language | Rule 1 in query prompt: "ALWAYS write queries in English" + sourceTitleHint |
| 3.4.0 | Filename relevance check backfired | "Meta" story → Minecraft screenshot | Substring "meta" appears in "Minecraft"; hot air balloon for "hot" paradox story | Removed filename check; correct fix = vision model relevance scoring |
| 3.4.0 | PNG diagrams from Wikimedia | Data charts and maps appearing as story photos | PNG files on Wikimedia are usually diagrams/charts, not photos | Hard-reject PNG; only JPEG and WebP accepted from Wikimedia |
| 3.4.2 | GitHub Actions secrets silent failure | All 9 cron editions cancelled or failed in 2s | `ESPRESSO_ADMIN_KEY` secret never set; GitHub passes empty string, not error | Set secrets in Actions settings; rewrite cron to use start-job + polling |
| 3.4.2 | Cron max-time 120s too short | Curl timed out before pipeline finished | Pipeline takes 30–250s; curl `--max-time 120` killed it midway | Raised to 300s; switched to job polling (no HTTP timeout risk) |
| 3.4.3 | Image container not full-bleed | Visible padding left/right of images | `max-w-2xl px-4` article constrained image to 672px | Negative margin breakout: `-mx-4 sm:-mx-8 lg:-mx-12` |
| 3.4.4 | Cloudflare breaks app.cupof.news | App went offline after Cloudflare setup | All A records set to Proxied; Fly.io TLS breaks behind Cloudflare proxy | Set app.cupof.news to DNS Only (grey cloud); only root + www proxied |

---

## 🚀 Quick Start

```bash
git clone https://github.com/paulfxyz/cup-of-news.git
cd cup-of-news
npm install
npm run dev
# → http://localhost:5000
```

Visit `http://localhost:5000/#/setup` → enter your [OpenRouter](https://openrouter.ai) API key.

Then `http://localhost:5000/#/admin` → password `admin` → **Generate Today's Digest**.

---

## 🔑 Admin

Default password: **`admin`**

Change it: Admin panel → red toolbar → **"Change password"**

Admin URL: `yourdomain.com/#/admin` (not linked anywhere in the public reader — intentionally hidden)

---

## ✏️ Editorial Prompt

The most powerful feature. In Admin → **Editorial** tab, write a paragraph describing who you are and what matters to you:

> *"I'm a tech entrepreneur in Lisbon. I care about AI, European startups, geopolitics, and climate. I prefer analytical takes. Skip celebrity news and US domestic politics unless globally significant. Favour The Economist, FT, and Wired."*

The AI injects this as a reader profile into every generation. Every digest becomes shaped by your curiosity, not a generic algorithm.

---

## 📡 API Reference

All write endpoints require `x-admin-key: your-password` header.

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/digest/latest` | Public | Latest published digest (20 stories) |
| `GET` | `/api/digest/:id` | Public | Any digest by ID |
| `GET` | `/api/digests` | Admin | All digests |
| `POST` | `/api/digest/generate` | Admin | Trigger AI pipeline |
| `POST` | `/api/digest/:id/publish` | Admin | Publish a draft |
| `POST` | `/api/digest/:id/unpublish` | Admin | Revert to draft |
| `PATCH` | `/api/digest/:id/story/:id/swap` | Admin | Swap one story |
| `PATCH` | `/api/digest/:id/story/:id` | Admin | Edit story manually |
| `PATCH` | `/api/digest/:id/quote` | Admin | Edit closing quote |
| `POST` | `/api/links` | Admin | Submit URL(s) |
| `GET` | `/api/links` | Admin | List links |
| `DELETE` | `/api/links/:id` | Admin | Delete link |
| `GET` | `/api/admin/editorial-prompt` | Admin | Get editorial prompt |
| `POST` | `/api/admin/editorial-prompt` | Admin | Save editorial prompt |
| `DELETE` | `/api/admin/editorial-prompt` | Admin | Clear editorial prompt |
| `POST` | `/api/admin/change-password` | Admin | Change password |
| `GET` | `/api/health` | Public | Health + version |

```bash
# Submit a link
curl -X POST https://app.cupof.news/api/links \
  -H "Content-Type: application/json" \
  -H "x-admin-key: your-password" \
  -d '{"url": "https://example.com/article"}'

# Multiple links
curl -X POST https://app.cupof.news/api/links \
  -H "Content-Type: application/json" \
  -H "x-admin-key: your-password" \
  -d '{"urls": ["https://...", "https://..."]}'
```

**Apple Shortcuts:** Create a Share Sheet shortcut → POST `location.href` to `/api/links`. Share any Safari page directly into Cup of News.

**Bookmarklet:**
```javascript
javascript:(function(){fetch('https://app.cupof.news/api/links',{method:'POST',headers:{'Content-Type':'application/json','x-admin-key':'your-password'},body:JSON.stringify({url:location.href})}).then(()=>alert('☕ Saved!'));})();
```

---

## ⏰ Daily Cron — 6 AM GMT

GitHub Actions is included (`.github/workflows/daily-digest.yml`). Add two repo secrets:

| Secret | Value |
|--------|-------|
| `ESPRESSO_URL` | `https://app.cupof.news` |
| `ESPRESSO_ADMIN_KEY` | Your admin password |

Optional repo variable: `AUTO_PUBLISH=true` skips manual review.

---

## 📱 Native App (iOS/Android)

The app is PWA-ready (installable from browser) and Capacitor-ready (native shell with one command). See [`NATIVE.md`](./NATIVE.md) for the full guide.

```bash
npm install @capacitor/core @capacitor/cli @capacitor/ios @capacitor/android
npm run build
npx cap add ios && npx cap add android
npx cap sync
npx cap open ios     # → Xcode
npx cap open android # → Android Studio
```

App ID: `news.cupof.app`

---

## 🔧 Deployment

See [INSTALL.md](./INSTALL.md) for all platforms. Quick version:

```bash
# Fly.io (recommended — persistent SQLite volume)
fly launch
fly volumes create cup_of_news_data --size 1 --region cdg
fly secrets set OPENROUTER_KEY=sk-or-... ADMIN_KEY=your-password DB_PATH=/data/cup-of-news.db
fly deploy
```

---

## 🗂️ Project Structure

```
cup-of-news/
├── shared/
│   ├── schema.ts              # Drizzle schema + TypeScript types (shared FE/BE)
│   └── editions.ts            # Edition registry: BCP 47 IDs, language instructions, categories
├── server/
│   ├── index.ts          # Express entry point
│   ├── routes.ts         # All API endpoints — edition query/body param on generate + latest
│   ├── pipeline.ts       # Daily digest generation engine — edition param, native language prompts
│   ├── trends.ts         # 34+ RSS sources per edition — 9 edition-specific source sets
│   └── storage.ts        # SQLite via Drizzle ORM (IStorage interface) — edition-aware queries
├── client/src/
│   ├── App.tsx            # Router + providers
│   ├── pages/
│   │   ├── DigestView.tsx     # Public reader — edition-aware API calls, flag selector
│   │   ├── AdminPage.tsx      # Admin panel — 9-edition flag selector for digest generation
│   │   └── SetupPage.tsx      # First-run configuration wizard
│   ├── components/
│   │   ├── AdminAuth.tsx       # Login gate + change password modal
│   │   ├── EditionSelector.tsx # Flag dropdown, localStorage persistence
│   │   └── ThemeProvider.tsx   # Dark/light mode context
│   └── index.css               # Economist design system tokens
├── .github/workflows/
│   └── daily-digest.yml       # Cron — 6:00 AM GMT
├── fly.toml                    # Fly.io deployment config
├── capacitor.config.ts         # Native iOS/Android config
├── Dockerfile                  # Multi-stage Node.js build
├── NATIVE.md                   # iOS/Android build guide
├── INSTALL.md                  # Full deployment guide
└── CHANGELOG.md                # Complete version history with engineering narrative
```

---

## 🛠️ Stack

| Layer | Technology | Why chosen |
|-------|-----------|-----------|
| Runtime | Node.js 20 + Express | Runs anywhere, minimal abstraction, easy to reason about |
| Frontend | React 18 + Vite + Tailwind + shadcn/ui | Fast builds, tree-shakeable, excellent DX |
| Database | SQLite (Drizzle ORM) | Zero infrastructure, single file, trivial backup |
| AI | OpenRouter (Gemini 2.5 Pro) | 400+ models, one API key, ~$0.07/digest |
| Content extraction | Jina Reader (free) | Handles paywalls, YouTube, TikTok — no key needed |
| Image extraction | OG metadata → HTML fallback → editorial SVG | 3-tier: always gets something good |
| RSS fallback | 34 public feeds | Transparent, inspectable, zero cost |
| Scheduling | GitHub Actions cron | Free, reliable, zero infrastructure |
| Hosting | Fly.io (Paris/CDG) | Persistent SQLite volume, no cold starts |
| Typography | Cabinet Grotesk + Libre Baskerville | Editorial, distinctive, not overexposed |
| Native | Capacitor | 100% code reuse, no React Native rewrite |

---

## 📝 Changelog

Full history with engineering narrative: **[CHANGELOG.md](./CHANGELOG.md)**

| Version | Date | Summary |
|---------|------|---------|
| **3.4.1** | Image display: object-contain replaces object-cover (no more cropping) |
| **3.4.0** | AI 5-query image pipeline: Gemini Flash generates diverse Wikimedia searches, aspect ratio scoring |
| **3.3.7** | AI-powered image selection (Gemini Flash → Wikipedia article photo), fix TR/IT red bars |
| **3.3.6** | Fix timeout (3→5min), graceful recovery checks DB after timeout, OpenRouter 150→240s |
| **3.3.5** | Fix stale closure in PinKeypad (useRef for finished flag), animated progress, success modal |
| **3.3.4** | Critical: AbortController timeouts on OpenRouter (150s) + Jina (20s), 3min pipeline cap |
| **3.3.3** | EventSource reconnect + 5s polling fallback (browser disconnect fix) |
| **3.3.2** | Fix SSE replay (stored type:log stripped step/done fields), fix progress bar |
| **3.3.1** | 2026-03-25 | Job-based SSE (EventSource GET), progress bar, log textarea, copy button |
| **3.3.0** | 2026-03-25 | SSE streaming generate, auto-unpublish before regenerate, definitive PIN keypad fix |
| **3.2.9** | 2026-03-25 | Fix generate-with-pin auto-publish, fix polling (ID-based not date-based), fix admin panel generate polling |
| **3.2.8** | 2026-03-25 | Fix PIN keypad (6 dots, PIN-only auth, polling), fix admin generate (async fire-and-forget + poll) |
| **3.2.7** | 2026-03-25 | PIN keypad for digest generation (triple-tap logo), click-outside grid/modal, admin PIN settings |
| **3.2.6** | 2026-03-25 | "Read again" button (9 languages native), QuoteCard theme-aware design, 222 RSS sources across 9 editions |
| **3.2.5** | 2026-03-25 | Fix 502 on digest generate (server timeout), persistent admin login, landing→app language handoff |
| **3.2.4** | 2026-03-25 | Cost corrected (~$0.07/digest, real Gemini 2.5 Pro rate), tagline updated, all 9 language translations proofread |
| **3.2.3** | 2026-03-25 | Russian flag fix (🌍 → 🇷🇺), landing page custom language dropdown matching app design |
| **3.2.2** | 2026-03-25 | Modal click-outside close, card slide animation, triple-click generate. Twice-daily cron (6 AM + 4 PM GMT). FTP + Fly.io deploy automation |
| **3.2.0** | 2026-03-25 | Turkish + Italian editions (9 languages total), logo hard-refresh (1250ms spinner + window.location.reload()), landing page full rewrite |
| **3.0.0** | 2026-03-23 | 4 new native language editions (ES, PT, ZH, RU), select dropdown lang switcher, Unicode dedup, dark mode default, React Query refresh UX |
| 2.0.2 | 2026-03-23 | Storage snake_case bug fix, DigestTab edition, typography calibration |
| 2.0.1 | 2026-03-23 | Responsive typography fix: leading-[3.0] → 1.9/2.2/2.6 per breakpoint |
| 2.0.0 | 2026-03-23 | 8 editions (EN/FR/DE), flag selector, native language generation per edition |
| 1.6.2 | 2026-03-23 | Critical fix: missing Rss import (blank page), auto_stop off |
| 1.6.1 | 2026-03-23 | Docs patch: version sync, model references updated to Gemini 2.5 Pro |
| 1.6.0 | 2026-03-23 | Gemini 2.5 Pro, multi-source attribution, diversity v4, RSS header removed |
| 1.5.1 | 2026-03-23 | Direct HTML OG image fallback, 34 RSS sources, 17/20 real photos |
| 1.5.0 | 2026-03-23 | Per-story sources modal, paragraph spacing, mandatory Sport/Culture/geographic coverage |
| 1.4.x | 2026-03-23 | Smart images, diversity rules, editorial SVG fallbacks, sources modal |
| 1.3.0 | 2026-03-23 | Editorial prompt — AI personalisation layer |
| 1.2.0 | 2026-03-23 | Renamed to Cup of News, PWA/Capacitor, app.cupof.news |
| 1.1.0 | 2026-03-23 | 20 stories per digest, full docs, line height improvements |
| 1.0.x | 2026-03-22 | Various fixes and polish |
| 0.2.0 | 2026-03-22 | Full audit — 10 bugs fixed, all code documented |
| 0.1.0-beta | 2026-03-22 | Initial release |

---

## 🗺️ Roadmap

**v3.4.1 shipped.** PIN keypad for digest generation (triple-tap logo), click-outside for All Stories grid, admin PIN settings, 222 RSS sources, Read Again button, QuoteCard theme-aware design, persistent admin login, landing→app language handoff, 502 timeout fix.

### v3.2 — Delivery & Channels
- 📧 Email delivery (Postmark / Resend) — digest in your inbox at 6 AM
- 📱 Telegram bot — `/add <url>` and `/digest` commands
- 🔔 Push notifications via Capacitor — native 6 AM alert
- 🗂️ Multiple channels — separate Tech / World / Finance feeds
- 🔖 Pocket / Readwise integration — auto-pull saved articles
- 🌐 Browser extension — one-click save
- 🛡️ Rate limiting — protect public API

### v3.0 — Trust & Verification Platform

The long-term vision: a transparent, battle-tested news verification platform.

| Feature | Description |
|---------|-------------|
| **3-source validation** | Every story requires 3+ distinct domains. Enforced at the pipeline level, not optional |
| **Friend network curation** | Share your Cup with trusted contacts. See how their editorial lens differs. Privacy-first (E2E encrypted) |
| **Source credibility scoring** | Internal scores: historical accuracy, correction rate, cross-reference validation |
| **Disinformation detection** | Cross-source narrative consistency + language pattern analysis (persuasion techniques) |
| **Multi-model ensemble** | Trend detection across Claude + GPT-4 + Gemini in parallel. Consensus reduces single-model bias |
| **Transparent provenance** | Full content lineage: "Story appeared in Source A at T1, Source B at T2" |
| **Why This Matters** | Auto-generated historical context, stakeholder analysis, counter-perspectives |
| **Multi-user** | Teams, shared digests, collaborative editorial prompts |

This roadmap reflects the mission: not just a personal digest, but a tool that actively fights disinformation through transparency, multi-source verification, and network intelligence.

---

## 🤝 Contributing

```bash
git checkout -b feature/my-thing
git commit -m 'feat: describe what you did'
git push origin feature/my-thing
# → open a Pull Request
```

---

## 📜 License

MIT — free to use, modify, distribute.

---

## 👤 Author

Made with ❤️ by **Paul Fleury** — built with **[Perplexity Computer](https://www.perplexity.ai/computer)**

[![Website](https://img.shields.io/badge/paulfleury.com-000?style=flat-square)](https://paulfleury.com)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-paulfxyz-0A66C2?style=flat-square&logo=linkedin)](https://www.linkedin.com/in/paulfxyz/)
[![GitHub](https://img.shields.io/badge/GitHub-paulfxyz-181717?style=flat-square&logo=github)](https://github.com/paulfxyz)
[![Email](https://img.shields.io/badge/hello@paulfleury.com-EA4335?style=flat-square&logo=gmail)](mailto:hello@paulfleury.com)

---

⭐ **If Cup of News improves your mornings, a star helps others find it.**
