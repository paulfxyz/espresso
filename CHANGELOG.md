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
