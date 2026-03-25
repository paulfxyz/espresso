## [3.2.9] — 2026-03-25

**Critical fix: generate-with-pin now auto-publishes. Polling uses digest ID comparison.**

### Root cause of 'nothing works after a minute'

1. `generate-with-pin` ran the pipeline and saved the digest as **draft**.
   The reader never shows drafts — only published digests.
   Fix: after `runDailyPipeline` resolves, immediately call
   `storage.updateDigest(id, { status: 'published', publishedAt: now })`.

2. The client poll checked `data.date === currentDigestDate && status === 'published'`.
   Two problems: (a) draft digests are never returned by `/api/digest/latest`
   anyway; (b) the date comparison used the client's local timezone which may
   differ from the server's UTC date.
   Fix: snapshot the previous digest ID before firing generate, then poll until
   `data.id !== previousDigestId`. ID comparison is timezone-independent and
   unambiguous.

3. Admin panel polling also used `d.date === today && d.edition === id` which
   had the same timezone problem. Fix: snapshot digest count before firing,
   poll until count increases.

---

## [3.2.8] — 2026-03-25

**Fixed PIN keypad (6 dots, PIN-only auth, polling). Fixed admin digest generation (async + polling).**

### Bug fix: PIN keypad

**Problem 1 — only 4 dots:** `Math.max(digits.length, 4)` always showed 4 dots
even for the 6-digit default PIN `123456`. Fixed to `PIN_LENGTH = 6` so the
display always shows 6 empty/filled dots.

**Problem 2 — "no code works":** After PIN verification, the keypad read
`localStorage.getItem("adminKey")` and redirected to `/#/admin` if absent.
This meant it only worked if the user had previously visited the admin panel.
Root cause: the admin key isn't available to the public reader by design.

Fix: new endpoint `POST /api/digest/generate-with-pin` that accepts `{ pin, edition }`
and verifies the PIN itself before running the pipeline. The admin key is never
needed on the client side. The endpoint returns immediately (202) and runs the
pipeline async — the client then polls `/api/digest/latest` every second until
a fresh digest for today appears.

**Problem 3 — no loading feedback during 90s generation:** The previous design
called fetch() and awaited the full 90s response inside the component, causing
the UI to appear frozen. New flow:
  1. POST `/api/digest/generate-with-pin` — returns in ~50ms
  2. UI immediately shows "Generating… Xs" phase with Loader2 spinner
  3. Polls `/api/digest/latest?edition=X` every 1s
  4. When today's published digest appears → "Digest ready!" → hard reload
  5. After 2 min max → reload anyway

**Other keypad fixes:**
  - Keyboard handler now has correct deps (useCallback on press/backspace/submit)
  - 4 phases: pin / generating / polling / done / error — distinct UI for each
  - "Try again" button in error phase
  - Close button hidden during generation (can't cancel a running pipeline)

### Bug fix: admin panel generate

**Problem:** POST `/api/digest/generate` takes 30-170s. The browser (and Fly's
proxy at 75s) drops the connection before the response arrives. The mutation
was awaiting `r.json()` on the response, which timed out.

**Fix in both OverviewTab and DigestTab:**
  - `fetch()` is fired with `.catch(() => {})` — we don't await the response body
  - An elapsed-second counter starts immediately
  - A 3-second poll of `/api/digests` watches for a new digest for today's date
    and the selected edition
  - When found: `invalidateQueries` + success toast with story count + elapsed time
  - After 3 min: give up and show "refresh to see result"
  - Button shows `Generating… 12s` during the wait

---

## [3.2.7] — 2026-03-25

**PIN keypad for digest generation. Click-outside to close grid overlay. Admin PIN settings.**

### 1. "All Stories" grid — click outside to close

The grid overlay (opened via the layout grid icon in the header) had no way to
close it by tapping the backdrop — only the X button worked.

Fix: same two-line pattern used for the sources modal:
- Outer `<div onClick={onClose}>` on the backdrop
- Inner `<div onClick={e => e.stopPropagation()}>` on the content panel

### 2. Triple-tap logo → PIN keypad (replaces direct generate)

The previous behaviour (triple-click → read adminKey from localStorage →
POST /generate) had two problems:
1. On mobile the admin key isn't always stored (user may not have visited /#/admin)
2. Typing a full password on a phone is a poor UX

New flow:
1. Triple-tap the "C" logo → PIN keypad modal appears
2. Enter a 4–8 digit PIN (default: `123456`)
3. Server verifies at `POST /api/admin/verify-pin` (public endpoint, no admin key)
4. On success: `POST /api/digest/generate` with adminKey from localStorage
   (if not stored → redirect to /#/admin to authenticate first)
5. On wrong PIN: shake animation + attempt counter (3 attempts → 30s lockout)

**Keypad design:**
- Full-screen backdrop (click outside to close)
- Dot display (● for entered digits, ○ for remaining)
- 3×3 numpad + bottom row: backspace | 0 | OK
- Keyboard support: 0-9, Backspace, Enter, Escape
- "Generating… Xs" elapsed counter while pipeline runs
- Descriptive error states (wrong PIN, network error, locked)

**New server endpoints:**
- `POST /api/admin/verify-pin` — public, verifies PIN against stored/default
- `GET  /api/admin/digest-pin/status` — admin, returns { configured }
- `POST /api/admin/digest-pin` — admin, sets new PIN (4–8 digits, digits only)

### 3. Admin panel — PIN settings

A "Digest Generation PIN" card was added to the Overview tab in the admin panel.
- Two fields: New PIN + Confirm PIN (both numeric, max 8 digits)
- Saves to `config` table as key `digest_pin`
- Default `123456` shown as placeholder
- `inputMode="numeric"` for mobile keyboard optimisation

---

## [3.2.6] — 2026-03-25

**"Read again" button (native in 9 languages). Quote card matches app design. 222 RSS sources.**

### "Read again" — all 9 editions

The end-of-digest button was labelled "New digest" (EN) or "Nouveau digest" (FR).
This was confusing — it doesn't generate a new digest, it goes back to story 1.
Replaced with "Read again" in all 9 languages with native-speaker register:

  EN → "Read again"      (clear, imperative)
  FR → "Relire"          ("re-read" — the idiomatic French term for rereading)
  DE → "Nochmal lesen"   ("read again" — natural German, used in book contexts)
  ES → "Leer de nuevo"   (standard, clear Spanish)
  PT → "Ler novamente"   (European Portuguese register)
  ZH → "再读一遍"          ("read one more time" — natural Mandarin)
  RU → "Читать снова"    ("read again" — natural Russian)
  TR → "Tekrar oku"      ("read again" — Turkish imperative, common UI pattern)
  IT → "Leggi di nuovo"  ("read again" — standard Italian)

### Quote card — matches app design

The closing quote card previously forced background: #000000 (pure black) with
hardcoded white text. This created a jarring visual break from the rest of the
reader (bg-background, text-foreground). Fixed:

- Wrapper: bg-background (respects dark/light theme)
- Quote text: text-foreground (was: text-white)
- Author: text-muted-foreground (was: text-white/35)
- Badge: border-border (was: border-white/15)
- Date: text-muted-foreground/50 (was: text-white/25)
- Nudge: text-muted-foreground/30 (was: text-white/15)
- Button: border-border, hover:bg-accent (was: border-white/20, hover:bg-white/5)

The red accent line and shimmer animations are preserved — they work against
both light and dark backgrounds.

### RSS sources — 222 total across 9 editions

Previous total: ~163 sources. New total: 222 sources.

Per-edition breakdown:
  EN: 32 → 53  (+21) Added: The Telegraph, The Independent, TechCrunch, Science AAAS,
                             NEJM, Bloomberg Tech, WSJ Business, Middle East Eye,
                             AllAfrica, Nikkei Asia, Pitchfork, Arts & Letters Daily,
                             The Athletic, Carbon Brief, Guardian Environment, DW EN,
                             France 24 EN, BBC UK, Guardian UK, NYT US, Al Jazeera Economy
  FR: 15 → 23  (+8)  Added: Le Monde International, Le Monde Sciences, Le Figaro Économie,
                             Libération, Le Revenu, Jeune Afrique, RFI Afrique, RTBF (BE),
                             Le Temps (CH), Euronews FR
  DE: 14 → 22  (+8)  Added: ARD Tagesschau, ZDF heute, Die Welt, Taz, Stern,
                             Wirtschaftswoche, ORF (AT), NZZ (CH)
  ES: 18 → 26  (+8)  Added: El Universal (MX), El Espectador (CO), La Tercera (CL),
                             El Comercio (PE), El Economista, 20 Minutos, Tendencias21, RT ES
  PT: 16 → 23  (+7)  Added: Observador, Correio da Manhã, SIC Notícias, Carta Capital,
                             Record, Canaltech BR, Ciência Hoje
  ZH: 11 → 16  (+5)  Added: CNA (Central News Agency Taiwan), Taiwan News,
                             Initium Media (端传媒), Nikkei Asia, SCMP EN
  RU: 12 → 18  (+6)  Added: iStories, The Insider, The Bell (бизнес), Novaya Gazeta Europa,
                             Медиазона, Фонтанка, Настоящее Время (Current Time TV)
  TR: 14 → 20  (+6)  Added: France 24 TR, Euronews TR, Anadolu Ajansı, Milliyet,
                             T24, Gazete Duvar, Fanatik Spor
  IT: 14 → 21  (+7)  Added: AGI (wire), Corriere Innovazione, Il Fatto Quotidiano,
                             Il Post, ANSA Cultura, Corriere dello Sport, Wired Italia

---

## [3.2.5] — 2026-03-25

**Fix 502 on digest generation. Persistent admin login. Landing→app language handoff.**

### Bug fix: 502 on POST /api/digest/generate

**Root cause:** Fly.io's HTTP proxy has a 75-second idle timeout. The digest
pipeline (Jina rate-limited → RSS fallback → OpenRouter ~30-90s) was exceeding
this limit. Fly drops the connection → client sees 502 Bad Gateway. The pipeline
was still running successfully on the server — the response just never arrived.

**Two-layer fix:**

1. `server/index.ts` — Node.js server-level timeouts:
   ```
   httpServer.keepAliveTimeout = 120_000   // above Fly's 75s idle timeout
   httpServer.headersTimeout   = 125_000   // must be > keepAliveTimeout
   ```
   These keep persistent connections alive between requests and through the
   proxy's idle window.

2. `server/routes.ts` — per-request timeout on the generate endpoint:
   ```
   req.socket?.setTimeout(170_000)
   res.setTimeout(170_000, () => res.status(504).json({ error: "..." }))
   ```
   If the pipeline genuinely hangs (model outage, network partition), the
   client now receives a proper 504 with a descriptive message instead of
   a bare connection reset.

Why Jina 429s don't cause the 502:
  The 429s are handled gracefully — Jina failures fall back to RSS headline
  text. The 502 was purely the response timeout, not the Jina errors.

### Bug fix: persistent admin login

**Root cause:** `adminKey` lived in React state only — cleared on every
page refresh or navigation away from `/#/admin`.

**Fix in `AdminAuth.tsx`:**
- `localStorage.setItem("adminKey", key)` on successful login
- On mount: read saved key, validate silently with `GET /api/links`
  - Valid → auto-authenticate (no login screen shown)
  - Stale/wrong → clear localStorage, show login screen
  - Network error → show login screen (conservative)
- `localStorage.removeItem("adminKey")` on explicit logout
- Brief spinner shown while silent validation runs (~100ms)

The `"adminKey"` localStorage key is the same key read by DigestView's
triple-click generate (v3.2.2) — consistent across the codebase.

### Feature: landing → app language handoff

**Problem:** Clicking "Open App" from the French landing page opened the app
in English — the app had no way to know which language the user was on.

**Solution (two parts):**

`landing/index.html` — `openApp()` function:
- All "Open App" links now call `openApp(e)` instead of navigating directly
- Reads current lang from `localStorage.cup_landing_lang`
- Navigates to `https://app.cupof.news/?lang=fr#/` (etc.)

`client/src/components/EditionSelector.tsx` — `useEdition` hook:
- On mount, reads `?lang=` URL param before checking `cup_edition_v3`
- If valid edition ID found: persists to `cup_edition_v3`, removes param
  from URL via `history.replaceState` (no reload, no bookmark pollution)
- Priority: URL param > localStorage > default English

Why URL param instead of postMessage or localStorage write:
  The landing (cupof.news) and app (app.cupof.news) are different origins.
  localStorage is origin-scoped — we cannot write to the app's storage
  from the landing page. A URL query param is the correct cross-origin
  state handoff mechanism. `history.replaceState` removes it immediately
  after reading so it doesn't persist in browser history.

---

## [3.2.4] — 2026-03-25

**Digest cost corrected. All 9 language translations proofread and updated.**

### Cost correction: ~$0.15 → ~$0.07 per digest

The cost stat and feat8 block across the landing page showed ~$0.15 per digest —
carried over from an early estimate before Gemini 2.5 Pro pricing was confirmed.

Real cost at current OpenRouter rates for Gemini 2.5 Pro:
- Input:  ~17,000 tokens × $1.25/M = $0.021
- Output: ~4,500  tokens × $10/M  = $0.045
- Total:  ~$0.07 per digest

Updated everywhere: stat bar (`~$0.07`), feat8 card title, feat8 card body,
all 9 TRANSLATIONS objects, README features table, README stack table,
README architecture diagram, INSTALL.md model comparison table,
server/index.ts startup auto-generate cost comment.

### Tagline correction

Old: "A year of daily digests costs less than a single coffee."
Math check: $0.07 × 365 × 2 = $51/year (twice daily, one edition).
That is not "less than a coffee." A Starbucks latte at $6.50 ≠ $51.

New (accurate): "A Starbucks latte buys you three months of daily digests."
Math: $6.50 ÷ $0.07 = 93 digests ÷ 1/day = 3 months. Honest and still punchy.

### Translations — all 9 languages proofread natively

Each language version of feat8_text was rewritten with correct cost and a
native-register Starbucks comparison:
- EN: "a Starbucks latte buys you three months of daily digests"
- FR: "un latte Starbucks vous offre trois mois de revues de presse quotidiennes"
- DE: "ein Starbucks-Latte reicht für drei Monate tägliche Nachrichtenzusammenfassungen"
- ES: "un café de Starbucks te da para tres meses de resúmenes diarios"
- PT: "um café no Starbucks paga três meses de digests diários"
- ZH: "一杯星巴克拿铁够支撑三个月的每日摘要"
- RU: "один латте в Starbucks покрывает три месяца ежедневных дайджестов"
- TR: "bir Starbucks latte üç aylık günlük özetleri karşılıyor"
- IT: "un caffè da Starbucks ti copre tre mesi di digest quotidiani"

Italian note: "un caffè" in Italian normally means espresso at a bar (€1).
We kept "Starbucks" explicitly to avoid the ambiguity — a bar espresso at €1
would make the comparison feel *too* cheap rather than accurate.

---

## [3.2.3] — 2026-03-25

**Russian flag corrected. Landing page language selector rebuilt as custom dropdown.**

### Russian flag fix

The Russian edition was using 🌍 (globe) as its flag — a deliberate workaround
chosen during v3.0.0 because Russia's geopolitical context made a flag choice
sensitive. On reflection, the globe emoji is confusing: it's already used for the
English "World" edition, making Russian visually indistinguishable in the edition
selector. The correct emoji 🇷🇺 is now used consistently:

- `shared/editions.ts`: `flag: "🌍"` → `flag: "🇷🇺"` in the ru edition block
- `landing/index.html`: select option + edition card
- `README.md`: language editions table

### Landing page — custom language dropdown (mirrors app design)

The native `<select>` element was replaced with a custom dropdown that exactly
mirrors `EditionSelector.tsx` from the React app:

**Trigger button:**
- Flag emoji + language code (e.g. 🇫🇷 FR) + animated chevron (rotates on open)
- Red border, hover: white border + subtle white fill
- `aria-expanded` updated on open/close for screen readers

**Dropdown panel (260px wide):**
- Red "Language" header label (matches "Edition" label in app)
- 9 rows: flag (22px) + name (bold) + source description (muted, truncated)
- Active row: red left border + red name text + ✦ mark (identical to app)
- Hover: subtle white/6% fill

**Behaviour:**
- Click trigger → open/close
- Click outside → close (mousedown listener on document)
- Escape key → close
- Selecting an edition calls `setLang(lang)` and closes the panel

**`setLang()` updated:**
- Now also updates the trigger's flag and code display
- Marks the active `.lang-option` row with `.active` class
- Fallback to English if lang not in EDITION_META

**Why not use a library:**
The landing page is a static HTML file served from Siteground — no build step,
no npm, no framework. The entire custom dropdown is ~120 lines of CSS + ~60 lines
of JS, self-contained and dependency-free.

---

## [3.2.2] — 2026-03-25

**Modal click-outside close. Card slide animations. Triple-click logo generates new digest.**

### 1. Sources modal — click outside to close

The sources modal now closes when the user taps the dark backdrop, consistent
with every other modal pattern on mobile. Implementation:
- Outer backdrop div gets `onClick={() => setOpen(false)}`
- Inner modal card gets `onClick={e => e.stopPropagation()}` to prevent the
  close from firing when interacting with the card content
- No library required — 2 lines of JSX

### 2. Card slide animation

Every card transition now plays a 280ms directional slide:
- Next (→): incoming card slides in from the right (`translateX(48px → 0)`)
- Prev (←): incoming card slides in from the left (`translateX(-48px → 0)`)
- Easing: `cubic-bezier(0.25, 0.46, 0.45, 0.94)` — iOS-style ease-out
- Triggered by: keyboard arrows, swipe, prev/next buttons, progress dots, grid select

Implementation: `slideDir` state + `slideKey` counter. Bumping `slideKey` causes
React to re-mount the wrapper div, which restarts the CSS animation. This is
simpler and more reliable than using `animation-play-state` or removing/re-adding
classes. CSS keyframes are injected inline so there's no build-step dependency.

Why 48px and not 100%: at 100% viewport width the slide is too dramatic on
large screens — the story headline visually "flies" across. 48px is enough to
communicate direction without being distracting.

### 3. Triple-click logo → generate new digest

Single click: unchanged — 1250ms spin → `window.location.reload()`

Triple click (3 clicks within 500ms window):
1. Reads admin key from localStorage (`adminKey` — same key as AdminPage)
2. If no key found: redirects to `/#/admin` so user can authenticate first
3. Shows Loader2 spinner on the logo + elapsed-seconds counter (`3s`, `4s`…)
   so the user knows a ~30-90s operation is running
4. `POST /api/digest/generate` with `{ edition: edition.id }` + `x-admin-key`
5. On 200 or 409 (already exists): 400ms pause → `window.location.reload()`
6. On error: amber flash with X icon for 3s, then resets to normal

Why 500ms window for triple-click detection:
- Below 300ms: double-taps on mobile trigger it accidentally
- Above 700ms: the user has to slow down too much to feel intentional
- 500ms is the standard browser double-click threshold

Why 409 is treated as success:
- If a digest already exists for today, the user still gets a hard reload
  which picks up the latest bundle and refreshes the UI
- No error message needed — "digest exists" is not a failure state

---

## [3.2.1] — 2026-03-25

**Twice-daily digest generation. Fly.io redeploy. Siteground landing page deployed via FTP.**

### Digest schedule — now twice per day
- GitHub Actions cron updated from `0 6 * * *` (once) to two schedules:
  `0 6 * * *` (6:00 AM GMT) and `0 16 * * *` (4:00 PM GMT)
- Morning edition: overnight + early news cycle
- Afternoon edition: midday developments, market closes, press conferences
- 409 idempotency guard already in place — double-fire is a no-op
- Timeout bumped from 15 → 20 minutes to give sequential 9-edition runs headroom
- Workflow renamed: "Digest Generation — All 9 Editions (6 AM + 4 PM GMT)"

### Deployment fixes
- Fly.io app redeployed — `app.cupof.news/api/health` now returns `3.2.0`
  (was stuck on `3.0.0` since the last deploy was Mar 23)
- Siteground landing page deployed via FTP (was never pushed live despite being
  built in v3.2.0 — the two-site problem strikes again)
  `cupof.news` now shows v3.2.0, 9 editions, TR + IT, correct meta tags

### Root cause — version mismatch
The app reported `3.0.0` on `/api/health` because `fly deploy` had not been run
since v3.0.0. The version number lives in `package.json` and is read at runtime —
it doesn't update itself on Fly just because the git repo changed. Fly.io requires
an explicit `fly deploy` to ship new code. Going forward: deploy is part of the
sprint checklist, not an afterthought.

---

## [3.2.0] — 2026-03-25

**Landing page complete rewrite. Logo refresh on landing page. All legacy references removed. Version bump.**

### Landing page — full rewrite from scratch

The cupof.news landing page had accumulated contradictory, outdated, and partially-translated
copy across 15+ development sessions. Rather than patching individual strings, the entire file
was discarded and rewritten from scratch in v3.2.0.

**Problems in v3.1.0 landing page (now fixed):**
  - `<meta name="description">` still read "8 world editions in English, French, and German" — unchanged since v2.0.0
  - OG description said "8 editions. 6 AM. Every day."
  - Stats bar showed "8" for the edition count (was `<div class="stat-num">8</div>`)
  - Section heading read "8 World Editions" in the EN string and "3 World Editions" in the DE/FR strings
  - Footer copyright showed "v3.0.0" not "v3.1.0"
  - Eyebrow badge showed "v3.0.0"
  - Hero badge said "8 editions" in some translated variants
  - Turkish and Italian editions were absent from the editions grid entirely
  - The `<select>` language switcher had 7 options (no 🇹🇷 TR, no 🇮🇹 IT)
  - Step 6 copy referenced "8 editions — World, US, UK, Canada (EN), France..."
  - `sources_note` still read "7 languages since v3.0.0" in FR/DE/ES/PT translations
  - Logo mark on landing page had no hover→refresh, no click→reload behaviour

**Root cause:** The landing page is a standalone static HTML file hosted on Siteground,
separate from the React app on Fly.io. It had been updated incrementally across each sprint
but v3.1.0's Turkish/Italian additions were applied to the app (editions.ts, trends.ts,
EditionSelector.tsx, DigestView.tsx) without a corresponding update to the static landing.
The result: the landing page described v2.0.0 in some places, v3.0.0 in others, and
v3.1.0 nowhere.

**Solution — complete rewrite:**
  - Every string audited. Zero occurrences of "8 editions", "3 languages", "7 languages",
    "3 world editions", "8 world editions" in the output.
  - Stats bar: 9 (language editions), 20 (stories), 34+ (RSS sources), ~$0.15 (cost)
  - Language select: all 9 options including 🇹🇷 TR and 🇮🇹 IT
  - Editions grid: all 9 cards, TR and IT with red left border to signal newness
  - Meta description: "9 languages. One API key." — reflects v3.2.0 reality
  - OG description: "9 languages. 6 AM. Every day."
  - Version badge and footer copyright: v3.2.0
  - "How it works" step 5 updated: "9 languages generate simultaneously"
  - All 9 translated variants (EN/FR/DE/ES/PT/ZH/RU/TR/IT) verified for consistency
  - TR and IT translations written as native-speaker copy, proofread for register

### Logo refresh — now implemented on landing page

The logo refresh behaviour from DigestView.tsx v3.1.0 is now mirrored on the landing page:
  - Hover the red "C" square → "C" glyph is replaced by a refresh SVG icon (CSS :hover)
  - Click → adds class `spinning` → CSS `@keyframes logo-spin` rotates the icon
  - After exactly 1250ms → `window.location.reload()` fires a hard page reload
  - The `spinning` class guard (`if el.classList.contains('spinning') return`) prevents
    double-click race conditions — identical logic to `if (logoSpinning) return` in the app
  - The refresh SVG is inline (no external dependency, no extra network request)

**Why the same delay?** The 1250ms isn't arbitrary — it's the minimum duration that makes
a click feel deliberate rather than accidental. Below ~800ms, users can't distinguish
a click from a tap hover. Above ~1500ms, it starts to feel broken. 1250ms is the sweet
spot that communicates "acknowledged, reloading" without frustration.

### Engineering notes — lessons from this sprint

**The two-site problem:** `cupof.news` (Siteground static) and `app.cupof.news` (Fly.io Node)
are different deployments. Changes to the app's edition registry don't automatically
propagate to the landing page. This is an inherent maintenance burden of the two-site
architecture. Future mitigation options:
  1. Serve the landing page from Express as a route (`GET /`), eliminating the separate host.
  2. Automate a post-deploy webhook that regenerates the static landing from a template.
  3. The current approach: always include the landing page in the sprint checklist.

Option 1 is the cleanest solution and is a candidate for v3.3.0.

**Translation completeness vs. machine translation:** All 9 translated variants were
written with native-speaker register in mind, not machine-translated. Key decisions:
  - French: "revue de presse" rather than "résumé de nouvelles" — the former is the
    idiomatic term French editors actually use for a morning briefing.
  - German: "Weltausgaben" dropped in favour of plain "Ausgaben" — the former felt
    corporate. "Ausgabe" is what German newspaper stands use.
  - Italian: "rassegna" considered for digest but "digest" is universally understood
    in Italian tech contexts. "Sintesi" used for summary (more precise than "riassunto").
  - Turkish: "özet" (summary/digest) is the correct journalistic term. "Bülten"
    (bulletin) was considered but implies radio/TV broadcast, not editorial.
  - Chinese: "摘要" (abstract/summary) for digest. "资讯" (information/news) for news
    rather than "新闻" which has a broadcast-TV connotation in simplified Chinese.

---

## [3.1.0] — 2026-03-25

**9 languages. Turkish & Italian editions. Logo hard-refresh. Landing page rewrite.**

### New language editions
Two new editions added to Cup of News: Turkish (tr 🇹🇷) and Italian (it 🇮🇹).
The platform now covers 9 native-language editions. Each new edition ships with:
  - Its own curated RSS source pool (12-14 native-language sources each)
  - AI generation instructions reinforced in both English and the target language
  - Fully localised UI strings (readSources, closingThought, prevStory, etc.)
  - Cultural/editorial focus instructions (sport slots, regional priorities)
  - Category name palette in the target language for AI JSON output

#### Turkish (tr 🇹🇷)
  - Sources: BBC Türkçe, DW Türkçe, TRT Haber, Cumhuriyet, Bianet, NTV, Hürriyet,
    Sözcü, Sabah (tech), Dünya Gazetesi — 12 Turkish + 2 English wire
  - Regional focus: Turkish domestic politics (TBMM, parties), economy (TCMB, lira,
    inflation), regional geopolitics (Middle East, Caucasus, Balkans, NATO),
    Turkey-EU relations, Turkish tech/startup ecosystem
  - Sport slot: Süper Lig, Milli Takım, UEFA Champions League, BSL basketball, F1

#### Italian (it 🇮🇹)
  - Sources: ANSA (3 feeds: top news, economy, technology), Corriere della Sera,
    La Repubblica, Il Sole 24 Ore (2 feeds), RAI News, La Stampa, TGCom24,
    Gazzetta dello Sport, DW Italiano — 12 Italian + 2 English wire
  - Regional focus: Italian politics (Parlamento, Governo, Quirinale), economy
    (FTSE MIB, PMI, turismo), EU from Italian perspective (4th largest EU economy),
    Italian culture (cinema, letteratura, gastronomia, moda, design), science/startups
  - Sport slot: Serie A, Formula 1 (Ferrari), tennis, Giro d'Italia, sci alpino

### Logo hard-refresh (v3.1.0 UX fix)
Previous behaviour: clicking the red "C" logo called React Query's `refetch()`,
which re-fetched `/api/digest/latest` but did NOT reload the JS bundle.
If a new version was deployed, users were still running stale JS until a manual
browser reload — a silent versioning trap.

New behaviour (3 states):
  1. **Normal**: shows "C" in red square.
  2. **Hover**: "C" switches to RefreshCw icon (CSS `group-hover`).
  3. **Click**: `logoSpinning = true` → RefreshCw gains `animate-spin` for exactly
     1250ms → `window.location.reload()` forces a full hard reload, re-downloading
     the JS bundle, ensuring the user runs the latest deployed version.

The 1250ms duration was chosen as the shortest interval that feels intentional
rather than a glitch, while still being short enough not to frustrate the user.
`disabled={logoSpinning}` prevents double-click race conditions during the animation.

### Landing page (cupof.news) — complete rewrite
The landing page was rebuilt from scratch to reflect the real v3.1.0 product.
Every section was rewritten with accurate information:

**Removed (wrong):**
  - "3 World Editions" section header
  - "Available in 3 editions — English, Français, Deutsch" body copy
  - The stat counter showing "8" (was a leftover from the 8-edition era of v2.0.0)
  - Any copy mentioning "8 editions"

**Added/updated:**
  - Stat counter: 9 (language editions)
  - All 9 editions shown in the editions grid with flag, name, native description
  - Turkish and Italian cards in the editions grid, marked "NEW v3.1.0"
  - Language <select> dropdown now includes 🇹🇷 TR and 🇮🇹 IT
  - Full native-quality translations for Turkish and Italian across all page keys
  - sources_note: "✦ 9 native languages since v3.1.0"
  - Version badge: v3.1.0

### GitHub repo description updated
New: "☕ AI morning briefing: 20 stories, 6 AM daily. 9 languages. Self-hosted.
One API key. Gemini 2.5 Pro · React · Express · SQLite · Fly.io"

---

### Challenges & how they were fixed

**Challenge 1: Turkish RSS landscape**
Turkish media presents a fragmented RSS landscape. Post-2016, several independent
outlets (140journos, Gazete Duvar) have inconsistent or paywalled RSS. Large conglomerates
(Hürriyet, Sabah) publish RSS but freshness and CORS vary by endpoint. The strategy:
anchor on international public broadcasters (BBC Türkçe, DW Türkçe) as the reliable
spine, then add domestic outlets (Cumhuriyet, NTV, TRT Haber) for local coverage.
Bianet is included as the primary independent investigative voice.
Total source count: 14 (12 Turkish + 2 English wire fallback).

**Challenge 2: Italian RSS — ANSA feed selection**
ANSA publishes many RSS endpoints but naming is inconsistent. Their main feed
`/sito/notizie/topnews/topnews_rss.xml` carries top-10 rotating headlines,
not a full stream. We combine 3 ANSA feeds (top news + economia + tecnologia)
to get broader coverage. Corriere della Sera uses `xml2.corrieredellasera.it`
(not the main domain) which requires the `atomStyle: false` default (plain RSS,
not Atom). The Gazzetta dello Sport feed covers the mandatory calcio slot which
is culturally non-negotiable for Italian readers.

**Challenge 3: The "8 editions" ghost**
The stat counter on cupof.news had been showing "8" since v2.0.0. In v3.0.0 it
was updated to "7" in the stat number but the section heading still said
"3 World Editions" — a copy/paste error from the initial v3.0.0 landing rewrite
where the features section body copy referenced the old 3-edition world.
v3.1.0 audit caught every instance: grep confirmed zero occurrences of
"8 editions", "3 languages", "3 editions", "3 world editions" in the new file.

**Challenge 4: Hard reload vs React Query refetch()**
The original logo-click called `refetch()` then `setCardIndex(0)`. During a
deployment window (Fly.io zero-downtime deploys take ~30s), a user who had the
app open would click the logo, see "New digest loaded", but still be running the
old JS bundle. `window.location.reload()` is the only reliable way to guarantee
the user gets the latest bundle. The 1250ms spinner makes the reload feel
intentional — not an accidental page refresh.

## [3.0.0] — 2026-03-23

**7 languages. Dark mode default. Refresh UX. Repo overhaul.**

### New language editions
Four new editions added to Cup of News: Spanish (es 🇪🇸), Portuguese (pt 🇧🇷),
Chinese Simplified (zh 🇨🇳), and Russian (ru 🌍). Each has:
  - Its own curated RSS source pool (15-18 native-language sources each)
  - AI generation instructions in the native language with cultural/editorial focus
  - Localised UI strings for every reader label
  - Category palette entries in `generateCategoryImage()` for SVG fallbacks
  - Full `aiRegionalFocus` guidance (e.g. LATAM for Spanish, Brazil+Portugal for PT,
    Asia-Pacific for Chinese, Eastern Europe + CIS for Russian)

Removed: all 8 legacy edition aliases (en-WORLD, en-US, en-CA, en-GB, en-AU,
fr-FR, fr-CA, de-DE). The principle is now strict: 1 edition = 1 language.

### Dark mode by default (ThemeProvider.tsx)
The app now opens in dark mode on first visit. The red/black editorial palette
and the celebration QuoteCard were always designed for dark backgrounds — this
makes the experience consistent from the first load.
Theme preference is persisted in localStorage ("cup_theme" key) so users who
prefer light mode keep their choice across sessions.

### Refresh UX
Two ways to refresh the digest:
  1. Logo button: hover over the red "C" square — it becomes a ↻ refresh icon.
     Click to check if a new digest is available and reset to card 0.
  2. QuoteCard button: large "New digest" button (localised per language) appears
     below the quote with a staggered fade-in (1.4s delay — after the reader
     has absorbed the quote). Clicking refreshes and returns to story 1.
Both buttons call React Query's `refetch()` on the digest query — no page reload.

### Landing page (cupof.news)
Language selector replaced flag tab buttons with a native <select> dropdown.
Supports all 7 languages. The EN/FR/DE copy is preserved from v2.3.0.
ES, PT, ZH, RU copy written natively by Claude — no machine translation.

### localStorage key reset
`cup_edition_v3` replaces `cup_edition_v2` to avoid stale values from prior versions.

### Version surfaces updated
package.json, routes.ts, all @version headers, README badge,
landing hero badge, all 7 footer_copy translations, CHANGELOG.

---

### Challenges & how they were fixed

**Challenge 1: Unicode dedup regex in trends.ts**
The old `normTitle()` used `[^a-z0-9\u00e0-\u024f]` which would strip Cyrillic
and CJK characters entirely, making all Chinese or Russian story titles deduplicate
as empty strings. Attempted fix: Unicode property escapes `/\p{L}/gu` — rejected
by the TypeScript compiler (target: ES2017, but Unicode property escapes require
explicit flag support). Final fix: explicit Unicode range whitelist covering Latin
Extended (0xC0-0x24F), Cyrillic (0x400-0x4FF), and CJK (0x4E00-0x9FFF, 0x3040-0x30FF).

**Challenge 2: Portuguese edition — Brazil vs Portugal**
Creating two separate editions ("pt-BR" and "pt-PT") would mean two digest slots
per day with largely similar stories. Better design: one "pt" edition drawing
from BOTH Brazilian (G1, Folha, Estadão) and Portuguese (Público, JN, Expresso)
sources equally, letting the AI synthesise a single digest that covers both markets.
This matches how Portuguese speakers actually consume news — Brazilians read
Portuguese press and vice versa for major stories.

**Challenge 3: Chinese RSS source scarcity**
Mainland Chinese outlets (Xinhua, People's Daily) do publish RSS but are
state-controlled. Independent Chinese-language journalism operates primarily
through international public broadcasters: BBC Chinese, DW Chinese, RFI Chinese,
Radio Free Asia, and Voice of America Chinese. The Chinese edition pool is
shorter than other editions (11 vs 15-18 sources) but all sources are
independent. Source quality > source quantity.

**Challenge 4: Russian feeds post-2022**
Several major Russian outlets are now blocked inside Russia or have shut down.
The reliable independent Russian RSS sources that remain: Meduza (Riga),
BBC Russian Service, DW Russian, Radio Free Europe/Liberty, RFI Russian.
TASS and RIA Novosti are explicitly excluded from the source pool.

## [2.3.0] — 2026-03-23

**Celebration quote card. Better image quality. Native French polish.**

### QuoteCard — gamified completion screen
The final card is now pure black (#000000, distinct from dark-mode #0f0f0f background)
with a staggered CSS entrance animation sequence:
  1. ✦ Completion badge pops in (cubic-bezier spring, 0.05s delay)
  2. Date fades up (0.3s)
  3. Red accent line grows from centre outward (0.5s)
  4. Quote fades up with gentle translate (0.6s)
  5. Author attribution fades in (0.9s)
  6. "You've read today's digest" nudge appears (1.1s)
  7. ✦ badge shimmer loops indefinitely as a completion signal

All animations are pure CSS keyframes injected via <style> tag — zero JS animation
libraries, zero extra bundle weight. The staggered timing creates a sense of reveal
rather than everything arriving simultaneously.

### Image quality improvements
The buildImageQuery() function now:
  - Detects named entities (capitalised mid-sentence words = countries, people, orgs)
    which produce the most photo-searchable results on Wikimedia
  - Adds a category-specific anchor term: Sports → "sport", Politics → "government",
    Business → "economy" etc. This biases Wikimedia toward news photography
    (match photos, parliament shots, financial charts) vs generic illustrations
  - Falls back to stop-word-filtered keywords + anchor if no named entities found
  - Wikimedia filter tightened: min 600px wide, ratio must be clearly landscape (>1.1)

### French landing page final polish
The v2.2.0 FR translations were already much improved. v2.3.0 polishes the remaining
rough edges: more idiomatic verb forms, better rhythm in feature descriptions.

### Version surface checklist (all updated)
  ✅ package.json: 2.3.0
  ✅ server/routes.ts health endpoint: "2.3.0"
  ✅ README badge: version-2.3.0-red
  ✅ All @version headers: 2.3.0
  ✅ Landing page: v2.3.0 in badge, footer (EN/FR/DE)
  ✅ CHANGELOG: this entry

---

## [2.2.0-landing] — 2026-03-23

**Landing page: native-quality French and German rewrites.**

The previous FR/DE translations were machine-translated from English.
Key problems fixed in French:
- "histoires curées" → "articles sélectionnés" (journalism term, not museum)
- "alimentez-le de vos sources" → "ajoutez vos sources favorites" (natural French)
- "sans être submergé" → "sans vous noyer dans l'info" (idiomatic)
- "circumvolutions" → "pas de langue de bois" (correct journalism idiom)
- "curé par l'IA" → "sélectionné et rédigé par l'IA" (correct term)
- "Alimentez. Dormez. Lisez." → "Choisissez. Dormez. Lisez." (snappier)
- "Un briefing qui vaut le lever." → "Un briefing qui vaut le réveil." (natural)
- Feature titles: "Diversité géographique garantie", "Des résumés éditoriaux",
  "Votre consigne éditoriale" (not "prompt" in French UI copy)

German improvements:
- "Geschichten" → "Nachrichten/Themen" (news, not tales/stories)
- "obligatorische globale Vielfalt" → "garantierte Vielfalt weltweit" (less bureaucratic)
- "Keine Floskeln" instead of "Kein Absichern" (correct idiom)
- "20 ausgewählte Themen" instead of "20 kuratierte Geschichten"
- "So funktioniert's" instead of "So funktioniert es" (natural spoken German)

Also updated EN/FR/DE for 3-edition model: "3 World Editions",
new edition descriptions, updated step 6 text.

---

## [2.2.0] — 2026-03-23

**3 editions (EN/FR/DE). Fixed incoherent sources. Stronger geographic diversity.**

### Engineering notes

**Simplifying from 8 editions to 3.**
Five of the eight editions were English with minor regional differences. Readers switching
between en-WORLD, en-US, en-GB, en-CA, en-AU saw essentially the same 20 stories.
The meaningful axis is LANGUAGE, not region. Three genuinely different editions:
- English: international press, global perspective, no regional bias
- Français: French-language sources first (RFI, France 24, Le Monde, Le Figaro, AFP FR,
  L'Équipe, Les Échos). Topics naturally skew toward French domestic news, EU affairs,
  Ligue 1, francophone Africa — a digest you'd read in Paris, not London.
- Deutsch: German-language sources first (DW, Spiegel, FAZ, SZ, Zeit, Handelsblatt,
  Kicker). Topics naturally skew toward Bundestag, DAX, Bundesliga, DACH region —
  a digest you'd read in Berlin, not Washington.

Backwards-compat aliases keep old 8-edition digest IDs working.

**Source enrichment bug: wrong sources appearing on stories.**
The `enrichStorySources()` function had a "topical fallback" that ran when Jaccard
keyword matching found no relevant articles. It would take the first N articles from
`allProcessed` in insertion order. Since `allProcessed = [...userProcessed, ...trendLinks]`,
those first articles were the earliest RSS stories fetched — completely unrelated.
This was why sources from story #1 kept appearing on stories #10-#20.

Fix: removed the fallback entirely. We only add a source if it has a genuine keyword
overlap (Jaccard score > 0). A story with 2 relevant sources is better than a story
with 4 where 2 are noise. With a diverse 60+ article RSS pool, Jaccard finds genuine
matches for almost every story anyway.

**Stronger geographic diversity prompt.**
Previous prompt had 5 mandatory geographic slots. New prompt has 7 mandatory slots
with per-COUNTRY caps (max 1 story per country) and per-REGION caps (max 2 per region).
Added explicit coverage requirements for South Asia, Central Asia/Eastern Europe, and
a broadened Middle East/North Africa requirement (not just Iran/Israel). Added a
self-check instruction: "list each story's primary country — if any appears twice, replace."
This directly addresses the recurring problem of 5 US stories + 3 Iran stories + nothing
from South America or Africa.

**Edition sport slot now per-edition field.**
The hardcoded ternary `edition.id === "de-DE" ? "Bundesliga..." : ...` replaced with
`edition.aiSportSlot` on each Edition object. Cleaner, no magic ID comparisons.

### ✨ Changed
- 8 editions → 3 editions: `en`, `fr`, `de`
- Edition IDs simplified (BCP 47 language tags, no country suffix)
- localStorage key reset to `cup_edition_v2` to clear stale 8-edition values
- Edition picker dropdown simplified to flat 3-item list (no language group headers)
- Reader counter uses `edition.ui.of` for localisation ("1 of 20" / "1 sur 20" / "1 von 20")

### ✨ Fixed
- Source enrichment: removed random fallback, genuine-only keyword-matched sources
- Geography: 7 mandatory regional slots, max 1 story per country, max 2 per region
- Sport slot: uses `edition.aiSportSlot` instead of hardcoded ID ternary

---

## [2.1.4] — 2026-03-23

**2 paragraphs, 50-70 words each. 4+ sources per story. All 8 editions regenerated.**

Summary format tightened:
- EXACTLY 2 paragraphs (not 2-3)
- Each paragraph 50-70 words (not 150-200 total)
- P1: what happened — facts, who, what, where
- P2: why it matters — context, significance, implications
- Total: 100-140 words, clean and readable

Source minimum raised from 3 → 4.
enrichStorySources() now pads to 4 sources using Jaccard keyword matching.
AI's additionalIdxs may already supply 2-5; enrichment tops up to 4 minimum.

All 8 editions (en-WORLD, en-US, en-CA, en-GB, fr-FR, fr-CA, de-DE, en-AU)
regenerated with the new format and published.

---

## [2.1.3] — 2026-03-23

**Story summaries now rendered as 2-3 paragraphs with clear spacing.**

The AI previously wrote summaries as a single block of text.
Now instructed to write 2-3 paragraphs separated by a blank line:
  P1: What happened — the core facts
  P2: Why it matters — context and significance
  P3 (optional): What comes next — implications and forward look

Frontend splits on `\n\n` and renders each paragraph as a separate `<p>`
with `space-y-5` gap between them. Old single-block summaries (no \n\n)
continue to render correctly as one paragraph.

---

## [2.1.2] — 2026-03-23

**Mandatory 3-source minimum enforced on every story. Source count badge on Read Sources button.**

### Engineering notes

**The core problem: AI only assigns additionalIdxs for duplicate-event articles.**
The AI groups articles covering the same event via additionalIdxs[]. This works
well for major breaking news (Iran/Israel → 3 outlets covering it). But unique
stories (a science discovery, a local election result, a culture piece) have only
1 RSS article in the pool covering that specific story. The AI correctly returns
additionalIdxs=[] for these — giving them 1 source.

The user requirement: every story must have at least 3 sources. Period.

**The fix: enrichStorySources() — a post-processing enrichment step.**
After the AI assigns sources, we run a second pass over every story with < 3
sources. We find the best-matching articles in allProcessed using Jaccard
similarity on title keywords (stop-word filtered, 4+ char words).

Why Jaccard similarity and not a second AI call:
- A second AI call per story = 20 extra API calls per generation = ~ extra/day
- The AI would likely hallucinate source URLs not in our pool
- Jaccard similarity on title words is fast, deterministic, and only returns URLs
  that actually exist in our fetched content pool

The function:
1. Extracts keywords from story title + summary (strip stop words, min 4 chars)
2. Scores every unused article by keyword overlap (Jaccard similarity)
3. Adds the top-scoring articles as additional sources up to 3 total
4. Falls back to topically adjacent articles if keyword matching < 3 sources

Result: 2/20 stories had 3+ sources before enrichment → 20/20 after.

**Source count badge on Read Sources button.**
The button now shows a red badge with the number of sources (e.g. "3").
This makes the multi-source feature visible at a glance without opening the modal.

### ✨ Added
- **enrichStorySources()**: mandatory 3-source minimum on every story
- **Source count badge**: visible on the Read Sources button

### ✨ Fixed  
- Set iteration TS error: Array.from() wrapper in jaccardScore

---

## [2.1.1] — 2026-03-23

**Admin crash fixed, carousel fixed, native-language sources, better images.**

### Engineering notes

**Admin crash: TypeScript type error crashing the entire panel.**
`AdminPage.tsx` had `headers` typed as `{ "x-admin-key": string } | {}`.
TypeScript correctly rejects this for `Record<string, string>` params since
`{}` has `undefined` for the key. At runtime this caused the component to
crash on render — the admin panel appeared to freeze.
Fix: explicit `const headers: Record<string, string> = ...`

**Carousel/grid crash: `edition` not destructured in GridOverlay.**
`GridOverlay` received `edition` as a prop (JSX attribute) and typed it in
the TypeScript interface, but never destructured it in the function parameters.
Result: `edition === undefined` at runtime, `edition.ui.allStories` threw
`Cannot read properties of undefined`. The grid overlay and story counter both
crashed, breaking the entire carousel view.
Fix: added `edition,` to the destructure list.

**Other TS errors fixed:**
- `pipeline.ts:fallbackImage` — undefined function in swapStory, replaced with
  `generateCategoryImage()` + `isValidOgImage()` check
- `pipeline.ts:825` — implicit `any` in `.filter()` type guard
- `trends.ts:516` — `matchAll()` iterator requires `Array.from()` wrapper

**Native language sources, not translations.**
The core complaint: switching to 🇫🇷 France produced French text but the stories
were clearly translated from English (Reuters/AP led the source pool). Fix:
- Native French feeds (RFI, France 24, Le Monde, Le Figaro etc.) moved FIRST
- Added AFP French feed (`afp.com/fr`) as the primary wire service in French
- English wire services reduced to 2 (Reuters + BBC) at the END of the pool
- Same fix for DE: DW/Spiegel/FAZ lead; only Reuters + BBC for global context
This means the AI synthesises from French/German content, not translates English.

**Image quality: Wikimedia Commons + picsum deterministic seeds.**
Unsplash: 50 req/hour free tier. With 20 stories × 8 editions = 160 requests per
run, we hit the limit on edition 2. Replaced with:
- Wikimedia Commons search API (no key, unlimited, freely licensed)
- picsum.photos with SHA-256 title hash as seed (deterministic, always works)
Unsplash still used first if UNSPLASH_ACCESS_KEY is set.

### ✨ Fixed
- Admin panel crash: headers type → `Record<string, string>`
- Carousel/grid crash: edition destructured in GridOverlay
- `fallbackImage` undefined in swapStory
- FR/DE sources: native feeds first, English wire last and reduced
- Image pipeline: Wikimedia + picsum fallback, no more rate limits
- 3 additional TypeScript errors cleared (zero errors now)

---

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

## [2.1.0] — 2026-03-23

**Full language localisation, image quality layer, admin fix, digest history.**

### Engineering notes

**Bug: French and German editions were generating in English.**
The `aiLanguageInstruction` and `aiRegionalFocus` fields from `shared/editions.ts`
were never injected into the pipeline system prompt. The editions registry had all
the right instructions — they were simply never used. The system prompt was a
hardcoded English template from v1.x that was never updated for v2.0.0 editions.

Fix: language block now injected as the FIRST section of the system prompt,
before diversity rules. Reason: LLMs follow early instructions better than
late ones. "Write in French" buried at position 600 in a 700-token prompt
gets ignored. At position 10, it's the primary constraint on output format.

Dual-language reinforcement: `"Write in French (Écrivez en français)"` —
English ensures the model parses the instruction; native-language phrase
activates native-language generation pathways. Testing showed this combination
is significantly more reliable than either alone.

Field-by-field enumeration: early tests had French summaries with English
titles, or mixed-language closingQuote. Listing every JSON field explicitly
closes those gaps completely.

**Bug: Admin panel frozen on first load.**
The login button had `disabled={loading || !password}` — the field started
empty, so the button was permanently disabled. The placeholder text showed
"admin" but that's a placeholder, not a value. Clicking Enter did nothing.
Fix: `disabled={loading}` only. Empty submission uses "admin" as default
(already implemented in handleLogin as `key = password.trim() || "admin"`).

**Feature: Reader UI localises when edition changes.**
Added `ui` object to every Edition definition with translated strings for:
"Read sources", "Prev", "Next", "All Stories", "Today's Thought", empty state,
and fallback notice. These flow through DigestView → StoryCard → SourcesStoryModal.
Switching from en-WORLD to fr-FR now changes both the content AND the interface.

**Feature: Digest generation always creates new entry.**
Previous behaviour: `updateDigest()` silently replaced any existing DRAFT for
today. Regenerating lost the previous version. New behaviour: always INSERT.
Multiple drafts per day per edition are fine. The reader shows the latest
published digest. Admin can see all versions and choose which to publish.

**Feature: Unsplash image quality layer.**
Added a third tier to the image fallback chain:
  Tier 1: Jina Reader og:image header (unchanged)
  Tier 2: Direct HTML Range fetch, og:image + twitter:image (unchanged)
  Tier 3: Unsplash keyword search — NEW. Extracts 4 meaningful words from
           the story title (stripping stop words), searches Unsplash for a
           landscape editorial photo. Returns the first high-quality result.
  Tier 4: Category SVG fallback (unchanged, always available)

Requires `UNSPLASH_ACCESS_KEY` env var (free at unsplash.com/developers).
Silently skipped if not configured — no crash, no degradation.

Query construction: "US and Iran trade threats over nuclear programme" →
strips stop words ["and", "over"] → "Iran trade threats nuclear". This
produces more accurate imagery than passing the full headline.

### ✨ Added
- **Reader UI localisation**: all interface strings change with edition language
- **Unsplash image search**: 3rd-tier fallback for editorial photos
- **Digest history**: always create new entry, never overwrite
- **v3.0 roadmap**: friend networks, disinformation detection, multi-model ensemble

### ✨ Fixed
- **Admin panel freeze**: login button now enabled with empty field (uses 'admin' default)
- **FR/DE language**: `aiLanguageInstruction` now injected first in system prompt
- **Edition prompt not used**: language, regional focus, and sport slots all injected
- **UI not localised**: Prev/Next/Read sources/etc. now translate with edition

---

## [2.0.3] — 2026-03-23

**The multi-edition blocker: SQLite UNIQUE constraint prevented generating any edition except en-WORLD.**

### Engineering notes

**The root cause: `UNIQUE(date)` on the digests table — a constraint from v1.x.**

When Cup of News was first built, the digests table was created with:
```sql
CREATE TABLE digests (
  date TEXT NOT NULL UNIQUE,  -- only one digest per day, ever
  ...
);
```
This was correct for v1.x: one global digest per day. When v2.0.0 added the `edition`
column and intended to support 8 digests per day (one per edition), the `UNIQUE(date)`
constraint was never updated. Every attempt to generate `en-US`, `fr-FR`, `de-DE` etc.
after `en-WORLD` was already generated for that day threw:
`UNIQUE constraint failed: digests.date`

The fix needed was `UNIQUE(date, edition)` — one digest per (day, edition) pair.

**Why ALTER TABLE doesn't work in SQLite.**

SQLite is intentionally minimal. Unlike Postgres/MySQL, it does not support:
- `ALTER TABLE DROP CONSTRAINT`
- `ALTER TABLE MODIFY COLUMN`
- `ALTER TABLE ADD CONSTRAINT`

The only supported ALTER TABLE operations in SQLite are:
- ADD COLUMN
- RENAME COLUMN (3.25.0+)
- RENAME TABLE

To change a constraint, you must rebuild the table. This is SQLite's documented
"12-step" table modification procedure:
1. Create new table with correct schema
2. Copy all data (INSERT INTO new SELECT * FROM old)
3. DROP old table
4. RENAME new table to old name
5. Recreate indexes

All in a single transaction so the database is never in an inconsistent state.

**The migration detection logic.**

The migration must be idempotent — safe to run on every startup:
```sql
SELECT COUNT(*) FROM sqlite_master
WHERE type='table' AND name='digests'
AND sql LIKE '%date%NOT NULL%UNIQUE%'       -- has old single-column unique
AND sql NOT LIKE '%UNIQUE(date, edition)%'  -- but not the new composite one
```
If this returns >0, the old constraint is present and we rebuild. After rebuild,
the condition is false and the migration is skipped on all subsequent startups.

**The pipeline bug: `getDigestByDate(today)` missing edition parameter.**

The "already exists" check in `runDailyPipeline` called:
```typescript
const existing = storage.getDigestByDate(today);  // defaults to en-WORLD
```
So after generating `en-WORLD`, ANY other edition's generation was blocked because
`getDigestByDate(today, "en-WORLD")` found the published en-WORLD digest and threw
"Published digest already exists". Fix: pass `editionId` explicitly.

**Fallback: never show an empty reader.**

Added `getLatestPublishedDigestAny()` — returns most recent digest across all
editions. The `/api/digest/latest` endpoint now cascades:
1. Exact edition match
2. Any published digest (with `isFallback: true` in response)
3. 404 only if DB is completely empty

The reader shows a non-intrusive banner when falling back: "France not generated yet.
Showing latest available edition. Generate →"

**Product vision note.**
The user shared an ambitious v3+ roadmap: friend networks, multi-model ensemble loops,
disinformation detection, blockchain provenance. These are genuinely exciting directions.
All are tracked as v3.x roadmap items. For now, the foundation needs to be solid:
every edition generating cleanly, every reader always having content, the DB schema
being correct. v2.0.3 closes the last structural gap.

### ✨ Fixed

- **SQLite UNIQUE(date) → UNIQUE(date, edition)** via idempotent table rebuild migration
- **`runDailyPipeline` edition check**: `getDigestByDate(today)` → `getDigestByDate(today, editionId)`
- **Never empty reader**: `getLatestPublishedDigestAny()` fallback in `/api/digest/latest`
- **Fallback banner** in DigestView: non-intrusive notice when showing cross-edition content
- **Roadmap updated** to reflect v3+ vision: friend networks, disinformation detection,
  multi-model loops, source credibility scoring

---

## [2.0.2] — 2026-03-23

**Three silent bugs fixed + typography calibrated to editorial sweet spot.**

### Engineering notes

**Bug 1 — `getLatestPublishedDigest` returning `undefined` for `storiesJson`.**

The root issue: two different query paths produce different column name conventions.
Drizzle ORM's `db.select()` automatically maps SQLite snake_case column names
(`stories_json`, `closing_quote`, etc.) to camelCase (`storiesJson`, `closingQuote`)
via its schema definition. But `sqlite.prepare().get()` (better-sqlite3's raw API)
bypasses Drizzle entirely and returns raw SQLite column names unchanged.

So `digest.storiesJson` returned by `getLatestPublishedDigest` was always `undefined`.
`routes.ts` then called `JSON.parse(undefined)` which throws `"undefined" is not valid JSON`
— the exact error users saw on every page load.

Fix: added `mapDigestRow(row)` helper that normalises both conventions using the `??`
operator: `storiesJson: row.storiesJson ?? row.stories_json`. Both paths now produce
identical camelCase objects regardless of which query path was used.

**Bug 2 — `getDigestByDate` WHERE clause only filtering by edition, ignoring date.**

The implementation was:
```typescript
.where(eq(digests.date, date) && eq(digests.edition, edition) as any)
```
The `&&` here is JavaScript boolean AND, not Drizzle's `and()` operator.
`eq(digests.date, date)` evaluates as a truthy Drizzle expression object.
JavaScript's `&&` returns the **right operand** when the left is truthy.
So the WHERE clause received only `eq(digests.edition, edition)` —
the date filter was silently discarded. You could get another day's digest
if the editions matched. Fix: replaced with raw SQL `WHERE date = ? AND edition = ?`.

**Bug 3 — DigestTab "Generate Today" button sent no edition.**

The Digest tab had its own `generateMutation` that called `POST /api/digest/generate`
with an empty body `{}`. The edition defaulted to `en-WORLD` regardless of
what the admin intended. Added `selectedEdition` state + flag pill selector to
the Digest tab header, matching the Overview tab's behaviour.

**Typography — calibrating to editorial sweet spot: "air without excess".**

Target: match the line density of NYT, FT, and The Economist mobile apps.
Not cramped. Not a government form with double-spacing.

The progression of body text iterations in this project is instructive:
- `leading-tight` (v0.5): too cramped — Libre Baskerville has tall ascenders
- `leading-[2.4]` (v1.1): better but still close
- `leading-[2.6] + word/letter-spacing` (v1.5): good on desktop, already excessive
- `leading-[3.0]` (v1.6): catastrophically large on mobile (54px gaps at 18px)
- `1.9/2.2/2.6` (v2.0.1): correct direction, but 2.6 on desktop still too loose
- `1.85/2.0/2.15` (v2.0.2): the right values.

Why these specific values:
- `1.85` mobile: at 15px font, a line-height of 1.85 = 27.75px gap. A 200-word
  paragraph at this density is 2.5 screens on a 375px phone — readable, one story.
- `2.0` tablet: the universally cited "comfortable" line-height at 17px.
- `2.15` desktop: at 19px, 2.15 = 40.8px. This is what broadsheet editorial apps
  use. 2.6 = 49.4px was the previous value — nearly 10px extra per line, visible.

Font size also stepped down: `text-[15px] sm:text-[17px] lg:text-[19px]`
replacing `text-base sm:text-lg lg:text-xl` (16/18/20px). One pixel tighter
at each breakpoint makes a meaningful difference on mobile scroll depth.

Word/letter-spacing removed entirely. Libre Baskerville's built-in spacing
is already optimised for body text — the additions made it feel artificially
expanded rather than typographically refined.

Quote card: `text-2xl/3xl/4xl` replacing `text-3xl/4xl/5xl`. The closing
quote was dominating the screen. Smaller = more contemplative, appropriate.

### ✨ Fixed

- `mapDigestRow()` added to `storage.ts` — normalises snake_case → camelCase
  for all raw SQL digest queries. Fixes the `storiesJson is undefined` crash.
- `getDigestByDate`: `&&` (JS boolean) → raw SQL `WHERE date = ? AND edition = ?`
- `DigestTab` generate button: now passes `{ edition }` body param + flag selector
- Typography: `text-[15/17/19px]`, `leading-[1.85/2.0/2.15]` responsive values
- Quote card font size reduced to be proportionate
- Word/letter-spacing removed from body text

---

## [2.0.1] — 2026-03-23

**Responsive typography fix: story body text line-height was catastrophically large on mobile.**

### Engineering notes

**The root cause: `leading-[3.0]` — a single class that broke mobile.**

Tailwind's `leading-[3.0]` sets `line-height: 3` — that means 300% of the font size.
On desktop at `text-2xl` (24px): line gaps of 72px. Already large, but tolerable on a
big screen reading horizontally-scrolled editorial content.
On mobile at `text-lg` (18px): line gaps of 54px. A 200-word summary took 3+ screens
of vertical scrolling. It looked like a government document printed with extra space
for annotations.

**Why it happened:** every line-height iteration was reviewed on desktop. The progression
was: tight (v1.1.0) → better but still tight (v1.5.0) → fixed with leading-[2.6] plus
word/letter-spacing (v1.5.0) → then pushed to leading-[3.0] after more complaints about
desktop spacing (v1.6.0). Nobody checked mobile after the final push. The stat: 200 words
at 18px × 54px line-height on a 375px phone = roughly 95 visible lines requiring ~8 scroll
gestures to read one story. Desktop was the same story but in 3-4 scrolls.

**The fix: responsive line-height with Tailwind breakpoint prefixes.**

Tailwind lets you prefix any utility with a breakpoint: `leading-[1.9] sm:leading-[2.2] lg:leading-[2.6]`.
The values chosen:
- `1.9` (mobile, default): tight but comfortable. Matches what iOS News and The Economist app
  use at similar font sizes. Leaves room to read without forcing excessive scrolling.
- `2.2` (sm, 640px+): more horizontal real estate, so slightly more vertical air feels right.
- `2.6` (lg, 1024px+): editorial broadsheet rhythm on large screens. This is what you'd
  find in a quality print magazine body text.

**Font size also reduced on mobile:** `text-lg → text-base` at mobile, `text-xl → text-lg`
at tablet. The combination of smaller font + lower line-height gives similar characters-per-line
count on mobile while fitting dramatically more text in the viewport.

**Other mobile compaction:**
- Article padding: `py-7 → py-5` mobile, `px-5 → px-4` mobile
- Hero image: `aspect-video → aspect-[16/7]` on mobile (less tall, keeps image present
  without dominating the small viewport)
- Headline margin-bottom: `mb-5 → mb-3` mobile
- Red accent divider: `mb-6 → mb-4` mobile
- Category row: `mb-4 → mb-3` mobile

**Why not just use CSS `@media` queries in a stylesheet?**
We're using Tailwind throughout the project. Mixing Tailwind responsive prefixes with
a separate stylesheet breakpoint creates two sources of truth for the same rule.
Tailwind's approach (`leading-[1.9] sm:leading-[2.2] lg:leading-[2.6]`) is
co-located with the element it controls — easier to audit, no cascade surprises.

**word-spacing and letter-spacing:** kept in inline style but reduced (0.05em → 0.03em,
0.015em → 0.01em). These are genuine improvements to horizontal rhythm at larger sizes
but become imperceptible on mobile text-base. A future improvement would be to make these
responsive too, but the current values are subtle enough not to cause problems.

### ✨ Fixed

- `leading-[3.0]` → `leading-[1.9] sm:leading-[2.2] lg:leading-[2.6]` on story summary paragraph
- Story body font size: `text-lg sm:text-xl lg:text-2xl` → `text-base sm:text-lg lg:text-xl`
- Article padding: `py-7 sm:py-10 lg:py-14` → `py-5 sm:py-8 lg:py-14`
- Hero image aspect ratio: `aspect-video` → `aspect-[16/7] sm:aspect-video`
- Headline margin: `mb-5` → `mb-3 sm:mb-5`
- Reduced word-spacing (0.05em → 0.03em) and letter-spacing (0.015em → 0.01em)

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
