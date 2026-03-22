# Internal Audit — v0.1.0-beta → v0.2.0

## Critical Issues Found

### 1. source.unsplash.com is a dead URL
`imageUrl` fallback uses `https://source.unsplash.com/800x450/?news` — this service
was shut down by Unsplash in 2023. Every story without an OG image gets a broken img tag.
**Fix:** Use `https://picsum.photos/seed/{hash}/800/450` (stable, free, no key).

### 2. OG image is fetched SEPARATELY from Jina
We call `extractViaJina(url)` and then `fetchRaw(url)` again just for OG metadata.
That's 2 HTTP requests per link. Jina already returns the og:image in its markdown output
as `Image: https://...` on line 3. We should parse it from there.
**Fix:** Parse `Image: ...` from Jina markdown instead of a second raw fetch.

### 3. Trend dedup is URL-only — misses same story on different URLs
Reuters and AP frequently run the same wire story. URL dedup doesn't catch this.
The AI does catch it eventually, but we're wasting tokens sending both.
**Fix:** Add title-similarity dedup (normalize + compare first 60 chars).

### 4. `swapStory` has a stale variable reference
Line 422: `const oldStory = stories[storyIdx]` — but `stories[storyIdx]` was ALREADY
replaced by `newStory` on line 418. `oldStory` is actually `newStory`. The old linkId
is never marked back as unprocessed. Minor data integrity issue.
**Fix:** Capture `oldLinkId` before the replacement.

### 5. Trend extraction is fully sequential
We extract trend items one by one in a for-loop. With 20 items × 5s each = 100s worst case.
User links are batched (8 parallel) but trend items aren't. Inconsistent and slow.
**Fix:** Apply the same chunked parallel extraction to trends.

### 6. No retry on OpenRouter transient failures
A single 429/503 kills the whole generation. One retry with 2s backoff costs nothing
and makes the pipeline much more robust in production.
**Fix:** Wrap `callOpenRouter` with a single retry on 429/5xx.

### 7. `extractTag` regex is ReDoS-vulnerable
`<${tag}[^>]*>([\s\S]*?)</${tag}>` with `[\s\S]*?` on large XML = catastrophic backtracking
on malformed feeds. Needs a max-length guard.
**Fix:** Slice feed XML to 100KB before parsing; add `.slice(0, 500)` on extracted values.

### 8. Config is re-read from DB on every pipeline run
`storage.getConfig("openrouter_key")` is called per request. Since SQLite is synchronous
this is fine for now, but worth noting for future caching.
**Minor — no fix needed for 0.2.0**

### 9. `source.unsplash.com` also in swapStory — same dead URL
Same issue as #1 in the swap path.

### 10. RSS `<link>` tag in Atom/RSS2 may be text node not attribute
Some feeds (FT, Economist) use `<link rel="alternate" href="..."/>` not `<link>text</link>`.
Our extractor only handles the text-node form, so FT/Economist URLs may be empty.
**Fix:** Add attribute-style `href` extraction as fallback.
