/**
 * @file server/pipeline.ts
 * @author Paul Fleury <hello@paulfleury.com>
 * @version 0.2.0
 *
 * Cup of News — Daily Digest Generation Pipeline
 *
 * Context:
 *   This is the core of Cup of News. It runs once per day (triggered by cron or
 *   manually from the admin panel) and produces a structured 10-story digest
 *   with editorial summaries and a closing quote.
 *
 * Pipeline steps:
 *   1. Collect unprocessed user links from DB
 *   2. Supplement with RSS trends if < MIN_LINKS_BEFORE_TRENDS user links exist
 *   3. Extract full text for each URL via Jina Reader (r.jina.ai)
 *      — Jina returns clean LLM-ready markdown + og:image in one request
 *      — No second raw HTML fetch needed (bug fixed in v0.2.0)
 *   4. Load 72h dedup history from past digests
 *   5. Call OpenRouter (single structured JSON call) to rank, summarize, quote
 *   6. Assemble DigestStory[] with images and metadata
 *   7. Persist digest as draft, mark links as processed
 *
 * Design decisions:
 *   - Single OpenRouter call per generation (not one per story). Cheaper and
 *     faster. The model receives all content and returns structured JSON in one
 *     shot using response_format: json_object.
 *   - SQLite is the "memory" — no vector DB, no embeddings. Past digest URLs
 *     are loaded into the prompt as a dedup hint.
 *   - Jina Reader is the extraction layer — free, no key, handles paywalls,
 *     YouTube transcripts, TikTok, Twitter. The og:image is parsed from Jina's
 *     markdown output (line 3: "Image: https://...") — no separate HTML fetch.
 *   - Image fallback uses picsum.photos (stable, seeded by content hash) —
 *     replaced the broken source.unsplash.com that was shut down in 2023.
 *   - OpenRouter calls include a retry on 429/5xx — one attempt with 2s backoff.
 *
 * Audit notes (v0.2.0 fixes applied):
 *   - FIXED: source.unsplash.com → picsum.photos/seed/{hash}
 *   - FIXED: double HTTP fetch per link (Jina + raw) → parse og:image from Jina
 *   - FIXED: swapStory used stale oldStory ref after in-place array mutation
 *   - FIXED: trend extraction was sequential → now chunked parallel (batch 4)
 *   - FIXED: OpenRouter no retry → added single retry with 2s backoff on 429/5xx
 *   - FIXED: idx bounds guard (AI occasionally returns idx outside array range)
 */

import { storage } from "./storage";
import type { DigestStory, Link } from "@shared/schema";
import { createHash, randomUUID } from "crypto";
import { fetchTrendingStories } from "./trends";

// ─── Constants ────────────────────────────────────────────────────────────────

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const JINA_PREFIX = "https://r.jina.ai/";

/**
 * If the user has submitted fewer links than this threshold, the pipeline
 * supplements with RSS trending stories from trusted outlets.
 * Rationale: 20 links gives the AI enough to pick a diverse top 20.
 * With fewer, it would just repeat the same handful of stories.
 */
const MIN_LINKS_BEFORE_TRENDS = 20;

/**
 * Parallel batch size for Jina extraction.
 * 4 concurrent requests is a safe ceiling — Jina is rate-limited per IP
 * and hammering it causes timeouts that degrade the whole pipeline.
 * User links: 4 parallel (higher priority, we want these fast)
 * Trend links: 4 parallel (same batch size for consistency)
 */
const EXTRACTION_BATCH_SIZE = 4;

/** Max text per article sent to the AI. 3000 chars ≈ 600 tokens — generous
 *  enough for the model to understand the story, cheap enough to pack 20+ items. */
const MAX_TEXT_PER_ARTICLE = 3000;

/** OpenRouter model. Gemini 2.5 Pro: superior instruction following for complex
 *  diversity rules and structured JSON output. Best quality/cost for this task.
 *  Change this to any OpenRouter model slug: https://openrouter.ai/models */
const DEFAULT_MODEL = "google/gemini-2.5-pro";

// ─── Utility Functions ────────────────────────────────────────────────────────

/** Returns today's date as YYYY-MM-DD in UTC */
function getTodayDate(): string {
  return new Date().toISOString().split("T")[0];
}

/** SHA-256 hex hash of a string — used for content dedup and image seed */
function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Detect content type from URL for admin display */
function detectSourceType(url: string): string {
  if (/youtube\.com|youtu\.be/.test(url)) return "youtube";
  if (/tiktok\.com/.test(url)) return "tiktok";
  if (/twitter\.com|x\.com/.test(url)) return "tweet";
  if (/reddit\.com/.test(url)) return "reddit";
  if (/substack\.com/.test(url)) return "substack";
  return "article";
}

/**
 * Parse og:image from Jina Reader markdown output.
 *
 * Jina returns a structured header at the top of every response:
 *   Title: Article Title
 *   URL Source: https://original-url.com
 *   Image: https://og-image-url.com/image.jpg   ← this line
 *   ...markdown content...
 *
 * This replaces the v0.1.0 approach of making a SECOND raw HTTP request to
 * extract OG metadata — cutting one fetch per link from the pipeline.
 */
function parseJinaOgImage(jinaMarkdown: string, baseUrl: string): string | null {
  const imgMatch = jinaMarkdown.match(/^Image:\s*(https?:\/\/\S+)/m);
  if (imgMatch) return imgMatch[1];

  // Fallback: inline markdown image on the first line of content
  const mdImgMatch = jinaMarkdown.match(/!\[.*?\]\((https?:\/\/[^)]+)\)/);
  if (mdImgMatch) return mdImgMatch[1];

  return null;
}

/**
 * Validate whether a URL is a usable story image.
 * Rejects: SVG logos, tracking pixels, known CDN fallback logos,
 * data URIs, tiny icons, and non-image URLs.
 */
function isValidOgImage(url: string | null): boolean {
  if (!url || url.length < 10) return false;
  if (url.startsWith("data:")) return false;

  // Reject SVGs (logos, icons — not photos)
  if (url.endsWith(".svg") || url.includes(".svg?")) return false;

  // Reject known tracking/analytics pixels
  const trackingHosts = ["bat.bing.com", "google.com/preferences", "pixel.", "beacon.", "track."];
  if (trackingHosts.some(h => url.includes(h))) return false;

  // Reject known outlet logo fallbacks (not editorial photos)
  const logoPatterns = [
    "logo", "favicon", "icon-google", "featured-logo",
    "assets/wired", "vector/euronews", "static/media/icon",
    "icon-192", "icon-512", "apple-touch",
  ];
  const lower = url.toLowerCase();
  if (logoPatterns.some(p => lower.includes(p))) return false;

  // Must look like an image path
  const imageExts = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"];
  const hasImageExt = imageExts.some(e => lower.includes(e));
  const hasImageCDN = ["cdn.", "images.", "img.", "media.", "static.", "photo", "thumb", "upload", "cpsprod", "i.guim", "i.imgur", "twimg"].some(h => lower.includes(h));

  return hasImageExt || hasImageCDN;
}

/**
 * Directly fetch a URL's HTML and extract the og:image meta tag.
 * Used as a second-pass fallback when Jina Reader doesn't return an image.
 * Fetches only the first 20KB of HTML (enough for <head>) to keep it fast.
 */
async function fetchOgImageDirect(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "CupOfNews-Bot/1.5 (+https://cupof.news)",
        "Accept": "text/html",
        "Range": "bytes=0-20000",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const html = await res.text();

    // og:image (standard)
    let m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
           || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    if (m) {
      let img = m[1];
      if (img.startsWith("//")) img = "https:" + img;
      if (img.startsWith("/")) { try { img = new URL(img, url).href; } catch {} }
      if (isValidOgImage(img)) return img;
    }

    // twitter:image fallback
    m = html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i);
    if (m) {
      let img = m[1];
      if (img.startsWith("//")) img = "https:" + img;
      if (img.startsWith("/")) { try { img = new URL(img, url).href; } catch {} }
      if (isValidOgImage(img)) return img;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Generate a category-styled SVG placeholder image for stories without a valid OG image.
 *
 * Why SVG instead of an image generation API:
 *   OpenRouter's image generation models (Gemini Flash Image, DALL-E) are either
 *   unreliable via the chat completions endpoint or require separate API keys.
 *   A well-designed SVG placeholder that matches the story category is more reliable,
 *   instant, and looks intentionally editorial rather than like a broken image.
 *
 *   The SVG uses the story's category to pick a colour scheme, adds a subtle grid
 *   pattern for texture, and displays the category label — clean, on-brand, zero cost.
 */
function generateCategoryImage(title: string, category: string): string {
  const palettes: Record<string, { bg: string; accent: string; dot: string }> = {
    Technology:   { bg: "#0f1729", accent: "#1d3461", dot: "#3b82f6" },
    Science:      { bg: "#0d1f0d", accent: "#1a3a1a", dot: "#22c55e" },
    Business:     { bg: "#1a0e00", accent: "#3d2000", dot: "#f59e0b" },
    Politics:     { bg: "#1a0000", accent: "#3d0000", dot: "#E3120B" },
    World:        { bg: "#0f0f1a", accent: "#1d1d3a", dot: "#8b5cf6" },
    Culture:      { bg: "#1a0f1a", accent: "#3a1f3a", dot: "#ec4899" },
    Health:       { bg: "#001a1a", accent: "#003a3a", dot: "#14b8a6" },
    Environment:  { bg: "#051a05", accent: "#0a3a0a", dot: "#84cc16" },
    Sports:       { bg: "#1a0a00", accent: "#3a1500", dot: "#f97316" },
    Other:        { bg: "#111111", accent: "#222222", dot: "#888888" },
  };
  const p = palettes[category] || palettes.Other;
  const short = title.length > 60 ? title.slice(0, 57) + "..." : title;
  const words = short.split(" ");
  const lines2: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > 32) { lines2.push(cur.trim()); cur = w; }
    else cur = (cur + " " + w).trim();
  }
  if (cur) lines2.push(cur.trim());
  const twoLines = lines2.slice(0, 2);

  const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const textEls = twoLines
    .map((l, i) => `<text x="40" y="${215 + i * 38}" font-family="Helvetica Neue" font-size="26" font-weight="800" fill="#fff" opacity="0.92">${escape(l)}</text>`)
    .join(" ");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 450"><defs><pattern id="g" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0L0 0 0 40" fill="none" stroke="${p.accent}" stroke-width="0.5" opacity="0.4"/></pattern></defs><rect width="800" height="450" fill="${p.bg}"/><rect width="800" height="450" fill="url(#g)"/><rect width="4" height="450" fill="${p.dot}"/><rect x="40" y="180" width="720" height="2" fill="${p.accent}" opacity="0.6"/><text x="40" y="160" font-family="Helvetica Neue" font-size="11" font-weight="700" letter-spacing="3" fill="${p.dot}" opacity="0.9">${category.toUpperCase()}</text>${textEls}<circle cx="760" cy="400" r="60" fill="${p.dot}" opacity="0.06"/><circle cx="760" cy="400" r="30" fill="${p.dot}" opacity="0.08"/></svg>`;
  return "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
}


// ─── Jina Reader ──────────────────────────────────────────────────────────────

/**
 * Extract full readable content from any URL via Jina Reader.
 *
 * Jina Reader (r.jina.ai) is a free public API that:
 * - Extracts clean markdown from any URL
 * - Handles paywalls, SPAs, YouTube transcripts, TikTok, Twitter/X
 * - Returns og:image in the header section
 * - Requires no API key
 *
 * Returns extracted text (capped at 8000 chars), title, and og:image.
 */
async function extractViaJina(
  url: string
): Promise<{ text: string; title: string; ogImage: string | null }> {
  const jinaUrl = `${JINA_PREFIX}${url}`;
  const res = await fetch(jinaUrl, {
    headers: {
      Accept: "text/markdown",
      "User-Agent": "CupOfNews-Bot/0.2",
      "X-Return-Format": "markdown",
      // Request og:image in the response header section
      "X-With-Images-Summary": "true",
    },
    signal: AbortSignal.timeout(20000),
  });

  if (!res.ok) throw new Error(`Jina HTTP ${res.status} for ${url}`);

  const rawText = await res.text();
  const titleMatch = rawText.match(/^Title:\s*(.+)/m);
  const title = titleMatch ? titleMatch[1].trim() : url;
  const ogImage = parseJinaOgImage(rawText, url);

  // Remove the Jina header block before returning content text
  const contentStart = rawText.indexOf("Markdown Content:");
  const text = contentStart > -1
    ? rawText.slice(contentStart + 18).trim().slice(0, 8000)
    : rawText.slice(0, 8000);

  return { text, title, ogImage };
}

// ─── OpenRouter ───────────────────────────────────────────────────────────────

/**
 * Make a structured JSON call to OpenRouter.
 *
 * Uses response_format: json_object to guarantee parseable JSON back.
 * Includes a single retry on 429 (rate limit) or 5xx (transient error)
 * with a 2-second backoff — added in v0.2.0 after observing occasional
 * OpenRouter 503s during peak hours.
 *
 * @param messages - OpenAI-format messages array
 * @param apiKey   - OpenRouter API key (sk-or-v1-...)
 * @param model    - OpenRouter model slug (default: DEFAULT_MODEL)
 */
async function callOpenRouter(
  messages: { role: string; content: string }[],
  apiKey: string,
  model = DEFAULT_MODEL
): Promise<string> {
  const body = JSON.stringify({
    model,
    messages,
    response_format: { type: "json_object" },
    temperature: 0.4,
    max_tokens: 16000,
  });

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "HTTP-Referer": "https://github.com/paulfxyz/cup-of-news",
    "X-Title": "Cup of News",
  };

  // Attempt 1
  let res = await fetch(OPENROUTER_API_URL, { method: "POST", headers, body });

  // Single retry on rate-limit or server error
  if ((res.status === 429 || res.status >= 500) && res.status !== 401) {
    console.warn(`⚠️  OpenRouter ${res.status} — retrying in 2s…`);
    await new Promise((r) => setTimeout(r, 2000));
    res = await fetch(OPENROUTER_API_URL, { method: "POST", headers, body });
  }

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenRouter error: ${res.status} — ${err}`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenRouter returned empty content");
  return content;
}

// ─── Extraction Helpers ───────────────────────────────────────────────────────

/**
 * Process a batch of links in parallel (up to EXTRACTION_BATCH_SIZE at once).
 * Returns successfully extracted items; failed items get a stub text entry
 * so they're not silently dropped from the AI's ranking pool.
 */
async function extractLinkBatch(
  links: Link[]
): Promise<Array<{ link: Link; text: string; title: string; ogImage: string | null }>> {
  const results = await Promise.allSettled(
    links.map(async (link) => {
      // Use cached extraction if available
      if (link.extractedText) {
        return {
          link,
          text: link.extractedText,
          title: link.title || link.url,
          ogImage: link.ogImage || null,
        };
      }

      try {
        const { text, title, ogImage: jinaOg } = await extractViaJina(link.url);

        // If Jina didn't find an OG image, do a direct lightweight HTML fetch
        let ogImage = jinaOg;
        if (!isValidOgImage(ogImage)) {
          ogImage = await fetchOgImageDirect(link.url);
        }

        // Cache back to DB (fire-and-forget — don't block pipeline on this)
        const hash = sha256(text);
        storage.updateLink(link.id, {
          extractedText: text,
          title,
          ogImage: ogImage || undefined,
          contentHash: hash,
          sourceType: detectSourceType(link.url),
        });

        return { link, text, title, ogImage };
      } catch (e) {
        console.warn(`⚠️  Jina extraction failed [${link.url}]:`, (e as Error).message);
        // Stub: title + URL still gives AI something to rank
        return {
          link,
          text: `${link.title || link.url}. Unable to extract full content.`,
          title: link.title || link.url,
          ogImage: null,
        };
      }
    })
  );

  return results
    .filter((r): r is PromiseFulfilledResult<any> => r.status === "fulfilled")
    .map((r) => r.value);
}

/**
 * Run extraction in sequential chunks of EXTRACTION_BATCH_SIZE.
 * Sequential chunks (not all-parallel) to avoid hammering Jina with 20
 * simultaneous requests, which triggers rate limiting and timeout cascades.
 */
async function extractAllLinks(
  links: Link[]
): Promise<Array<{ link: Link; text: string; title: string; ogImage: string | null }>> {
  const results: Array<{ link: Link; text: string; title: string; ogImage: string | null }> = [];

  for (let i = 0; i < links.length; i += EXTRACTION_BATCH_SIZE) {
    const chunk = links.slice(i, i + EXTRACTION_BATCH_SIZE);
    const batch = await extractLinkBatch(chunk);
    results.push(...batch);
  }

  return results;
}

// ─── Main Pipeline ────────────────────────────────────────────────────────────

/**
 * Run the daily digest generation pipeline.
 *
 * This is the main entry point called by the cron trigger and the
 * POST /api/digest/generate endpoint.
 *
 * Idempotency: if a DRAFT digest already exists for today, it is overwritten.
 * If a PUBLISHED digest exists for today, generation is blocked (explicit
 * regeneration requires unpublishing first).
 *
 * @param apiKey - OpenRouter API key from DB config or env
 * @returns { digestId, storiesCount } on success
 */
export async function runDailyPipeline(
  apiKey: string
): Promise<{ digestId: number; storiesCount: number }> {
  const today = getTodayDate();

  // Block regeneration if today's digest is already published
  const existing = storage.getDigestByDate(today);
  if (existing?.status === "published") {
    throw new Error(
      `Published digest already exists for ${today}. Unpublish it first to regenerate.`
    );
  }

  // ── Step 1: Collect user links ───────────────────────────────────────────

  const userLinks = storage.getUnprocessedLinks();
  console.log(`🔗 ${userLinks.length} unprocessed user link(s) in pool`);

  // ── Step 2: Trend fallback ───────────────────────────────────────────────

  let trendLinks: Array<{
    link: Link;
    text: string;
    title: string;
    ogImage: string | null;
  }> = [];

  if (userLinks.length < MIN_LINKS_BEFORE_TRENDS) {
    const needed = MIN_LINKS_BEFORE_TRENDS - userLinks.length;
    console.log(`📰 Supplementing with trending stories (need ${needed}+ more)…`);

    try {
      const trends = await fetchTrendingStories(needed);

      // Convert trend stories to synthetic Link objects for uniform processing
      const trendAsLinks: Link[] = trends.map((t) => ({
        id: 0,
        url: t.url,
        title: t.title,
        sourceType: "trend",
        extractedText: null,
        processedAt: null,
        digestId: null,
        ogImage: null,
        notes: `Auto-fetched from ${t.source}`,
        submittedAt: new Date().toISOString(),
        contentHash: null,
      }));

      // Extract trend content with same batched approach as user links
      trendLinks = await extractAllLinks(trendAsLinks);
      console.log(`📰 ${trendLinks.length} trend items extracted`);
    } catch (e) {
      console.warn("⚠️  Trend supplementation failed:", (e as Error).message);
    }
  }

  // ── Step 3: Extract user links ───────────────────────────────────────────

  const userProcessed = await extractAllLinks(userLinks);
  console.log(`✅ ${userProcessed.length} user links extracted`);

  // Merge: user links first (higher priority in AI prompt)
  const allProcessed = [...userProcessed, ...trendLinks];

  if (allProcessed.length === 0) {
    throw new Error(
      "No content available. Submit some links, or check server connectivity for RSS fallback."
    );
  }

  // ── Step 4: Load 72h dedup history ──────────────────────────────────────

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 3);

  const recentStoryUrls = new Set<string>();
  for (const d of storage.getAllDigests()) {
    if (new Date(d.date) <= cutoff) continue;
    try {
      const stories: DigestStory[] = JSON.parse(d.storiesJson);
      stories.forEach((s) => recentStoryUrls.add(s.sourceUrl));
    } catch {}
  }

  console.log(`🔁 ${recentStoryUrls.size} URLs in 72h dedup pool`);

  // ── Step 5: AI ranking + summarization ──────────────────────────────────

  // Load editorial prompt — user-defined personality/interest layer
  // Stored in config table under key "editorial_prompt"
  const editorialPrompt = storage.getConfig("editorial_prompt") || "";

  const contentItems = allProcessed.map((p, idx) => ({
    idx: idx + 1,
    url: p.link.url,
    title: p.title,
    sourceType: p.link.sourceType || "article",
    recentlyUsed: recentStoryUrls.has(p.link.url),
    textPreview: p.text.slice(0, MAX_TEXT_PER_ARTICLE),
    isTrend: p.link.sourceType === "trend",
    trendSource: p.link.notes || undefined,
  }));

  // Build the system prompt — base rules + user's editorial lens
  // The editorial prompt is the most powerful personalisation layer:
  // it tells the AI *who you are* and *what you care about*, so it can
  // select and frame stories through your specific lens.
  const editorialSection = editorialPrompt.trim()
    ? `\n\nREADER PROFILE & EDITORIAL LENS (high priority — let this guide your selection and tone):\n${editorialPrompt.trim()}`
    : "";

  const systemPrompt = `You are the editorial AI for "Cup of News" — a curated morning news digest inspired by The Economist Espresso. Your writing is intelligent, slightly opinionated, and respects the reader's time.

Your task: from the provided list of articles, select exactly 20 that together form the best morning briefing. Prioritize newsworthiness, recency, diversity of topics, and global relevance.${editorialSection}

EDITORIAL MANDATE — BREADTH IS NON-NEGOTIABLE:
You are the editor of a world briefing read at breakfast. A reader should finish feeling they understand TODAY'S WORLD — not just one corner of it.

HARD LIMITS — breaking any of these means the digest has FAILED:
- MAX 2 stories about any single ongoing conflict or crisis (Iran/Israel = 2 max, then STOP — pick 2 best angles only)
- MAX 2 stories involving the same country (includes stories that are primarily about that country)
- MAX 2 stories with the same person, company, or institution as the primary subject
- MAX 3 stories in any single category
- If multiple articles cover the SAME NEWS EVENT from different outlets — do NOT treat them as separate stories. Group them using additionalIdxs (multi-source) instead. One story, multiple perspectives.

MANDATORY SLOTS — your 20 stories MUST include ALL of the following:
✦ AT LEAST 2 Technology or Science stories (AI breakthroughs, medical research, space, climate tech)
✦ AT LEAST 2 Business or Economics stories (markets, M&A, central banks, trade, earnings)
✦ AT LEAST 2 Sports stories (football, tennis, F1, athletics, basketball — any sport)
✦ AT LEAST 1 Culture story (film, music, art, books, fashion, architecture)
✦ AT LEAST 1 Health or Environment story (medicine, climate change, nature, food systems)
✦ AT LEAST 1 story from SUB-SAHARAN AFRICA (not North Africa / Middle East)
✦ AT LEAST 1 story from ASIA-PACIFIC (Japan, India, China, SE Asia, Australia — NOT Middle East)
✦ AT LEAST 1 story from THE AMERICAS (USA, Canada, Brazil, Mexico, Latin America)
✦ AT LEAST 1 story from EUROPE (EU, UK, Russia — separate from Middle East)
✦ NO MORE THAN 3 stories from the Middle East/Iran/Israel/Gaza conflict zone

BEFORE FINALISING: count your stories per category and region. If you're short on a mandatory slot, REMOVE a story from an over-represented area and replace it.
- No more than 2 stories from any single country

QUALITY:
- Each summary: maximum 200 words, active voice, editorial confidence — no hedging
- Headlines: specific and informative, not clickbait
- Imagine a reader who wants to feel informed about the whole world over breakfast — not exhausted by one topic
- If a reader profile is provided above, honour their interests — but NEVER at the cost of geographic and topical breadth
- Return ONLY valid JSON matching the schema. No markdown fences, no extra keys.`;

  const userPrompt = `Here are ${contentItems.length} articles. Select the 20 best and summarize them. Then add a closing quote.

ARTICLES:
${JSON.stringify(contentItems, null, 2)}

Required JSON response:
{
  "stories": [
    {
      "idx": <primary source idx from above, 1-based>,
      "additionalIdxs": [<up to 2 more idx values that also covered this story — for multi-source coverage>],
      "title": "<headline, max 80 chars, strong and specific>",
      "summary": "<editorial summary, max 200 words, active voice, synthesise across sources if multiple>",
      "category": "<exactly one of: Technology|Science|Business|Politics|World|Culture|Health|Environment|Sports|Other>"
    }
  ],
  "closingQuote": "<an inspiring or thought-provoking quote, thematically relevant to today's stories>",
  "closingQuoteAuthor": "<Full Name, Role/Context>"
}

IMPORTANT: For additionalIdxs — if multiple articles in the list cover the SAME story from different angles or sources, group them here. This gives readers 3 perspectives on important stories instead of just 1. Do this especially for major breaking news.`;

  console.log(`🤖 Calling OpenRouter (${DEFAULT_MODEL}) with ${contentItems.length} articles…`);

  const rawJson = await callOpenRouter(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    apiKey
  );

  // ── Step 6: Parse and validate AI response ───────────────────────────────

  let aiResult: any;
  try {
    aiResult = JSON.parse(rawJson);
  } catch {
    throw new Error("OpenRouter returned invalid JSON: " + rawJson.slice(0, 300));
  }

  if (!aiResult.stories || !Array.isArray(aiResult.stories)) {
    throw new Error("Unexpected AI response — missing stories array");
  }

  // ── Step 7: Assemble stories with images ─────────────────────────────────

  const stories: DigestStory[] = aiResult.stories
    .slice(0, 20)
    .map((s: any): DigestStory | null => {
      // Guard against AI returning out-of-bounds idx
      const original = allProcessed[s.idx - 1];
      if (!original) {
        console.warn(`⚠️  AI returned idx ${s.idx} but only ${allProcessed.length} items exist`);
        return null;
      }

      // Image: use OG only if it passes validation, otherwise mark for generation
      const ogValid = isValidOgImage(original.ogImage || null);
      const imageUrl = ogValid
        ? original.ogImage!
        : `__GENERATE__:${s.title}:${s.category}`;

      // Collect additional sources from additionalIdxs
      const additionalIdxs: number[] = Array.isArray(s.additionalIdxs)
        ? s.additionalIdxs.filter((i: number) => i > 0 && i <= allProcessed.length && i !== s.idx)
        : [];

      const sources = [
        // Primary source
        {
          url: original.link.url,
          title: original.title || original.link.url,
          domain: (() => { try { return new URL(original.link.url).hostname.replace("www.", ""); } catch { return original.link.url; } })(),
        },
        // Additional sources (up to 2 more)
        ...additionalIdxs.slice(0, 2).map((i: number) => {
          const src = allProcessed[i - 1];
          if (!src) return null;
          return {
            url: src.link.url,
            title: src.title || src.link.url,
            domain: (() => { try { return new URL(src.link.url).hostname.replace("www.", ""); } catch { return src.link.url; } })(),
          };
        }).filter(Boolean) as Array<{url:string;title:string;domain:string}>,
      ];

      return {
        id: randomUUID(),
        title: s.title || original.title || "Untitled",
        summary: s.summary || "",
        imageUrl,
        sourceUrl: original.link.url,
        sourceTitle: original.title || original.link.url,
        category: s.category || "Other",
        linkId: original.link.id,
        sources,
      };
    })
    .filter((s): s is DigestStory => s !== null);

  if (stories.length === 0) {
    throw new Error("AI returned 0 valid stories — check the OpenRouter response format");
  }

  // ── Step 7b: Generate images for stories with missing/invalid OG images ──
  // Run in parallel (max 4 at once) — non-blocking on failure
  const needsGeneration = stories.filter(s => s.imageUrl.startsWith("__GENERATE__:"));
  console.log(`🖼️  ${stories.length - needsGeneration.length} valid OG images, ${needsGeneration.length} need generation`);

  if (needsGeneration.length > 0) {
    // Generate category-styled SVG images synchronously (instant, no API call)
    for (const story of needsGeneration) {
      const parts = story.imageUrl.replace("__GENERATE__:", "").split(":");
      const category = parts[parts.length - 1];
      const title = parts.slice(0, -1).join(":");
      story.imageUrl = generateCategoryImage(title, category);
    }
  }

  // ── Step 8: Persist digest ───────────────────────────────────────────────

  const digestData = {
    date: today,
    status: "draft" as const,
    storiesJson: JSON.stringify(stories),
    closingQuote: aiResult.closingQuote || "",
    closingQuoteAuthor: aiResult.closingQuoteAuthor || "",
    generatedAt: new Date().toISOString(),
    publishedAt: null,
  };

  const digest = existing
    ? storage.updateDigest(existing.id, digestData)
    : storage.createDigest(digestData);

  // Mark user links as processed (trend links have id=0, skip them)
  for (const story of stories) {
    if (story.linkId > 0) {
      storage.updateLink(story.linkId, {
        processedAt: new Date().toISOString(),
        digestId: digest!.id,
      });
    }
  }

  console.log(`✅ Digest #${digest!.id} generated: ${stories.length} stories`);
  return { digestId: digest!.id, storiesCount: stories.length };
}

// ─── Story Swap ───────────────────────────────────────────────────────────────

/**
 * Swap one story in an existing digest for another from the unused link pool.
 *
 * Admin workflow: the editor clicks "Swap" on a story they don't like.
 * We find the next unused link in the DB, extract + summarize it via AI,
 * and replace the target story in the digest JSON.
 *
 * v0.2.0 fix: capture oldLinkId BEFORE mutating stories[], not after.
 * The previous version captured `oldStory` after the array mutation, so it
 * was reading the new story's linkId instead of the old one.
 *
 * @param digestId - ID of the digest containing the story to swap
 * @param storyId  - UUID of the specific DigestStory to replace
 * @param apiKey   - OpenRouter API key
 */
export async function swapStory(
  digestId: number,
  storyId: string,
  apiKey: string
): Promise<DigestStory> {
  const digest = storage.getDigest(digestId);
  if (!digest) throw new Error("Digest not found");

  const stories: DigestStory[] = JSON.parse(digest.storiesJson);
  const storyIdx = stories.findIndex((s) => s.id === storyId);
  if (storyIdx === -1) throw new Error("Story not found in digest");

  // Capture old linkId BEFORE mutation (v0.2.0 bug fix)
  const oldLinkId = stories[storyIdx].linkId;

  // Find next unused user link (with extracted content for speed)
  const usedLinkIds = new Set(stories.map((s) => s.linkId));
  const candidates = storage
    .getAllLinks()
    .filter((l) => !usedLinkIds.has(l.id) && l.extractedText);

  if (candidates.length === 0) {
    throw new Error("No more unused links available to swap. Submit more links first.");
  }

  const candidate = candidates[0];

  const rawJson = await callOpenRouter(
    [
      {
        role: "system",
        content: `You are the editorial AI for "Cup of News" morning digest. Summarize the provided article with intelligence and editorial confidence.`,
      },
      {
        role: "user",
        content: `Article:
Title: ${candidate.title}
URL: ${candidate.url}
Content: ${(candidate.extractedText || "").slice(0, MAX_TEXT_PER_ARTICLE)}

Return JSON:
{
  "title": "<headline max 80 chars>",
  "summary": "<editorial summary max 200 words>",
  "category": "<Technology|Science|Business|Politics|World|Culture|Health|Environment|Sports|Other>"
}`,
      },
    ],
    apiKey
  );

  const aiResult = JSON.parse(rawJson);

  const newStory: DigestStory = {
    id: randomUUID(),
    title: aiResult.title || candidate.title || "Untitled",
    summary: aiResult.summary || "",
    imageUrl: candidate.ogImage || fallbackImage(candidate.url),
    sourceUrl: candidate.url,
    sourceTitle: candidate.title || candidate.url,
    category: aiResult.category || "Other",
    linkId: candidate.id,
  };

  // Replace story in array and persist
  stories[storyIdx] = newStory;
  storage.updateDigest(digestId, { storiesJson: JSON.stringify(stories) });

  // Mark new link as processed; old link becomes unprocessed again
  storage.updateLink(candidate.id, {
    processedAt: new Date().toISOString(),
    digestId,
  });

  // Free the old link back to the unprocessed pool
  if (oldLinkId > 0) {
    storage.updateLink(oldLinkId, { processedAt: null, digestId: null });
  }

  console.log(`🔄 Swapped story in digest #${digestId}: "${newStory.title}"`);
  return newStory;
}
