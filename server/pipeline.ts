/**
 * @file server/pipeline.ts
 * @author Paul Fleury <hello@paulfleury.com>
 * @version 3.5.9
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
import { getEdition, DEFAULT_EDITION } from "@shared/editions";
import { rehostImage, ensureImagesDir, getStoredImageQuality, deleteStoredImage, generateAiImage } from "./images";

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

  // Reject OG images with known branding overlay URL parameters
  const overlayParams = [
    "overlay-base64=",    // Guardian/Guim overlay injection
    "overlay-align=",     // Guardian overlay positioning
    "overlay-width=",     // Guardian overlay sizing
    "watermark=",         // generic watermark param
  ];
  if (overlayParams.some(p => lower.includes(p))) return false;

  // Reject known video thumbnail and broadcast screenshot CDN patterns
  const videoThumbnailPatterns = [
    "brightcove.com",          // Brightcove video platform thumbnails (France24, etc.)
    "cf-images.us-east-1.prod.boltdns.net",  // Brightcove CDN
    "players.brightcove.net",
    "img.youtube.com",         // YouTube video thumbnails
    "i.ytimg.com",             // YouTube image CDN
    "static.sendtonews.com",   // Broadcast video thumbnail service
    "thumbnails.cnn.video",    // CNN video thumbnails
  ];
  if (videoThumbnailPatterns.some(p => lower.includes(p))) return false;

  // Reject portrait-format URL patterns — these are explicitly cropped tall
  // e.g. NYT "verticalTwoByThree735", "portrait", "2by3", "tall", "9x16"
  const portraitPatterns = [
    "vertical", "portrait", "2by3", "2-by-3", "9x16", "9by16",
    "9-by-16", "tallimage", "tall-image", "_tall", "-tall",
  ];
  if (portraitPatterns.some(p => lower.includes(p))) return false;

  // Must look like an image path
  const imageExts = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"];
  const hasImageExt = imageExts.some(e => lower.includes(e));
  const hasImageCDN = ["cdn.", "images.", "img.", "media.", "static.", "photo", "thumb", "upload", "cpsprod", "i.guim", "i.imgur", "twimg"].some(h => lower.includes(h));

  return hasImageExt || hasImageCDN;
}

/**
 * Check actual image dimensions by fetching just the image headers.
 * Returns {w, h} if detectable, null otherwise.
 * Used to reject portrait OG images that pass URL pattern checks.
 * We fetch only enough bytes to read JPEG/PNG dimension headers (first 24 bytes).
 */
async function getImageDimensions(url: string): Promise<{ w: number; h: number } | null> {
  try {
    const res = await fetch(url, {
      headers: { "Range": "bytes=0-1023", "User-Agent": "CupOfNews/3.4" },
      signal: AbortSignal.timeout(4_000),
    });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);

    // JPEG: FF D8 — dimensions at various offsets, parse SOF marker
    if (bytes[0] === 0xFF && bytes[1] === 0xD8) {
      let i = 2;
      while (i < bytes.length - 8) {
        if (bytes[i] === 0xFF) {
          const marker = bytes[i + 1];
          // SOF markers: C0-C3, C5-C7, C9-CB, CD-CF
          if ((marker >= 0xC0 && marker <= 0xCF) && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
            const h = (bytes[i + 5] << 8) | bytes[i + 6];
            const w = (bytes[i + 7] << 8) | bytes[i + 8];
            if (w > 0 && h > 0) return { w, h };
          }
          const len = (bytes[i + 2] << 8) | bytes[i + 3];
          i += 2 + len;
        } else { i++; }
      }
    }

    // PNG: 89 50 4E 47 — dimensions at bytes 16-23
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes.length >= 24) {
      const w = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
      const h = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
      if (w > 0 && h > 0) return { w, h };
    }

    // WebP: RIFF....WEBP VP8
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes.length >= 30) {
      // VP8 chunk: width at bytes 26-27 (14-bit), height at 28-29 (14-bit)
      if (bytes[12] === 0x56 && bytes[13] === 0x50 && bytes[14] === 0x38) {
        const w = ((bytes[26] | (bytes[27] << 8)) & 0x3FFF) + 1;
        const h = ((bytes[28] | (bytes[29] << 8)) & 0x3FFF) + 1;
        if (w > 0 && h > 0) return { w, h };
      }
    }

    return null;
  } catch {
    return null;
  }
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
/**
 * generateCategoryImage — deterministic SVG placeholder per news category.
 *
 * Final fallback when all image fetching fails. Each category has its own
 * colour palette (dark background + accent colour). The story headline is
 * rendered in the SVG so even the fallback contains meaningful content.
 * Zero cost, instant, always available, never a broken image.
 */
function generateCategoryImage(title: string, category: string): string {
  const palettes: Record<string, { bg: string; accent: string; dot: string }> = {
    Technology:   { bg: "#0f1729", accent: "#1d3461", dot: "#3b82f6" },
    Technologie:  { bg: "#0f1729", accent: "#1d3461", dot: "#3b82f6" },
    Technologie2: { bg: "#0f1729", accent: "#1d3461", dot: "#3b82f6" },
    Science:      { bg: "#0d1f0d", accent: "#1a3a1a", dot: "#22c55e" },
    Wissenschaft: { bg: "#0d1f0d", accent: "#1a3a1a", dot: "#22c55e" },
    Business:     { bg: "#1a0e00", accent: "#3d2000", dot: "#f59e0b" },
    Économie:     { bg: "#1a0e00", accent: "#3d2000", dot: "#f59e0b" },
    Wirtschaft:   { bg: "#1a0e00", accent: "#3d2000", dot: "#f59e0b" },
    Politics:     { bg: "#1a0000", accent: "#3d0000", dot: "#E3120B" },
    Politique:    { bg: "#1a0000", accent: "#3d0000", dot: "#E3120B" },
    Politik:      { bg: "#1a0000", accent: "#3d0000", dot: "#E3120B" },
    World:        { bg: "#0f0f1a", accent: "#1d1d3a", dot: "#8b5cf6" },
    Monde:        { bg: "#0f0f1a", accent: "#1d1d3a", dot: "#8b5cf6" },
    Welt:         { bg: "#0f0f1a", accent: "#1d1d3a", dot: "#8b5cf6" },
    Culture:      { bg: "#1a0f1a", accent: "#3a1f3a", dot: "#ec4899" },
    Kultur:       { bg: "#1a0f1a", accent: "#3a1f3a", dot: "#ec4899" },
    Health:       { bg: "#001a1a", accent: "#003a3a", dot: "#14b8a6" },
    Santé:        { bg: "#001a1a", accent: "#003a3a", dot: "#14b8a6" },
    Gesundheit:   { bg: "#001a1a", accent: "#003a3a", dot: "#14b8a6" },
    Environment:  { bg: "#051a05", accent: "#0a3a0a", dot: "#84cc16" },
    Environnement:{ bg: "#051a05", accent: "#0a3a0a", dot: "#84cc16" },
    Umwelt:       { bg: "#051a05", accent: "#0a3a0a", dot: "#84cc16" },
    Sports:       { bg: "#1a0a00", accent: "#3a1500", dot: "#f97316" },
    Sport:        { bg: "#1a0a00", accent: "#3a1500", dot: "#f97316" },
    Other:        { bg: "#111111", accent: "#222222", dot: "#888888" },
    Autre:        { bg: "#111111", accent: "#222222", dot: "#888888" },
    Sonstiges:    { bg: "#111111", accent: "#222222", dot: "#888888" },
    // Spanish
    Tecnología:   { bg: "#0f1729", accent: "#1d3461", dot: "#3b82f6" },
    Ciencia:      { bg: "#0d1f0d", accent: "#1a3a1a", dot: "#22c55e" },
    Economía:     { bg: "#1a0e00", accent: "#3d2000", dot: "#f59e0b" },
    Política:     { bg: "#1a0000", accent: "#3d0000", dot: "#E3120B" },
    Mundo:        { bg: "#0f0f1a", accent: "#1d1d3a", dot: "#8b5cf6" },
    Cultura:      { bg: "#1a0f1a", accent: "#3a1f3a", dot: "#ec4899" },
    Salud:        { bg: "#001a1a", accent: "#003a3a", dot: "#14b8a6" },
    "Medio Ambiente": { bg: "#051a05", accent: "#0a3a0a", dot: "#84cc16" },
    Deportes:     { bg: "#1a0a00", accent: "#3a1500", dot: "#f97316" },
    Otros:        { bg: "#111111", accent: "#222222", dot: "#888888" },
    // Portuguese
    Tecnologia:   { bg: "#0f1729", accent: "#1d3461", dot: "#3b82f6" },
    Ciência:      { bg: "#0d1f0d", accent: "#1a3a1a", dot: "#22c55e" },
    // Economia / Política / Mundo / Cultura / Salud overlap with Spanish
    Saúde:        { bg: "#001a1a", accent: "#003a3a", dot: "#14b8a6" },
    "Meio Ambiente": { bg: "#051a05", accent: "#0a3a0a", dot: "#84cc16" },
    Esportes:     { bg: "#1a0a00", accent: "#3a1500", dot: "#f97316" },
    Outros:       { bg: "#111111", accent: "#222222", dot: "#888888" },
    // Chinese (Simplified)
    "科技":        { bg: "#0f1729", accent: "#1d3461", dot: "#3b82f6" },
    "科学":        { bg: "#0d1f0d", accent: "#1a3a1a", dot: "#22c55e" },
    "经济":        { bg: "#1a0e00", accent: "#3d2000", dot: "#f59e0b" },
    "政治":        { bg: "#1a0000", accent: "#3d0000", dot: "#E3120B" },
    "国际":        { bg: "#0f0f1a", accent: "#1d1d3a", dot: "#8b5cf6" },
    "文化":        { bg: "#1a0f1a", accent: "#3a1f3a", dot: "#ec4899" },
    "健康":        { bg: "#001a1a", accent: "#003a3a", dot: "#14b8a6" },
    "环境":        { bg: "#051a05", accent: "#0a3a0a", dot: "#84cc16" },
    "体育":        { bg: "#1a0a00", accent: "#3a1500", dot: "#f97316" },
    "其他":        { bg: "#111111", accent: "#222222", dot: "#888888" },
    // Russian (Cyrillic)
    "Технологии":  { bg: "#0f1729", accent: "#1d3461", dot: "#3b82f6" },
    "Наука":       { bg: "#0d1f0d", accent: "#1a3a1a", dot: "#22c55e" },
    "Экономика":   { bg: "#1a0e00", accent: "#3d2000", dot: "#f59e0b" },
    "Политика":    { bg: "#1a0000", accent: "#3d0000", dot: "#E3120B" },
    "Мир":         { bg: "#0f0f1a", accent: "#1d1d3a", dot: "#8b5cf6" },
    "Культура":    { bg: "#1a0f1a", accent: "#3a1f3a", dot: "#ec4899" },
    "Здоровье":    { bg: "#001a1a", accent: "#003a3a", dot: "#14b8a6" },
    "Экология":    { bg: "#051a05", accent: "#0a3a0a", dot: "#84cc16" },
    "Спорт":       { bg: "#1a0a00", accent: "#3a1500", dot: "#f97316" },
    "Другое":      { bg: "#111111", accent: "#222222", dot: "#888888" },
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

/**
 * fetchEditorialImage — multi-query AI image selection (v3.4.0)
 *
 * STRATEGY:
 *   Ask gemini-2.0-flash-001 to generate 5 diverse Wikimedia Commons search
 *   queries at temperature=0.1. For each query, search Wikimedia and take the
 *   first qualifying landscape photo. Stop at the first hit.
 *
 *   Why 5 queries: a single query often returns nothing or the wrong thing.
 *   5 queries cover: person name, action, location, topic, visual concept.
 *   First hit wins — no AI ranking of results needed.
 *
 * FULL FALLBACK CHAIN (v3.4.8):
 *   1. Jina Reader og:image (already run during extraction)
 *   2. Direct HTML Range fetch (already run)
 *   3. AI 5-query → Wikimedia Commons, vision-checked (score ≥ 7)
 *   4. Unsplash (if UNSPLASH_ACCESS_KEY set)
 *   5. null → caller uses generateCategoryImage SVG (correct, on-brand, zero cost)
 *
 * picsum.photos removed: random photos are worse than the SVG fallback.
 * A wolf photo is not better than a branded Technology SVG for a tech story.
 */
async function fetchEditorialImage(
  title: string,
  category: string,
  summary: string,
  apiKey?: string,
  sourceTitleHint?: string,  // Original source title (often English) — helps query generation for non-EN editions
  sourceUrl?: string         // The original article URL — tried first for OG image re-fetch
): Promise<string | null> {
  // ── Tier 2.5: Re-fetch OG image directly from the news source ─────────────
  // This is the most important tier for breaking news (Meta trial, Lukashenko,
  // Zimbabwe story etc.) — the original Reuters/BBC/AP article has the editorial
  // photo already. Jina may have failed or returned a bad URL during extraction.
  // We try a fresh direct fetch here and rehost the result as WebP.
  if (sourceUrl) {
    const freshOg = await fetchOgImageDirect(sourceUrl);
    if (freshOg && isValidOgImage(freshOg)) {
      // Reject tiny images (video stills, icons) before spending API credits on vision check
      const dims = await getImageDimensions(freshOg);
      if (dims && (dims.w < 600 || dims.h < 300)) {
        console.log(`  🚫 OG too small (${dims.w}×${dims.h}) — skipping to Wikimedia`);
      } else {
        // Vision-check the OG image — rejects branded overlays, logos, watermarks
        const ogScore = apiKey ? await checkImageRelevanceWithVision(freshOg, title, apiKey) : 7;
        if (ogScore >= 7) {
          const hostedOg = await rehostImage(freshOg);
          if (hostedOg) {
            console.log(`  📰 OG re-fetch: rehosted (vision ${ogScore}/10) from ${sourceUrl.slice(0, 60)}`);
            return hostedOg;
          }
          // rehostImage rejected the image (quality gate) — fall through to Wikimedia
          console.log(`  📰 OG re-fetch: rehostImage rejected (low quality) — falling through to Wikimedia`);
          // Do NOT return freshOg — continue to Tier 3
        } else {
          console.log(`  🚫 OG vision check failed (score ${ogScore}/10) — falling through to Wikimedia`);
        }
      }
    }
  }

  // ── Tier 3: AI multi-query → Wikimedia (vision-checked, score ≥ 7) ────────
  if (apiKey) {
    const wikiPhoto = await fetchFromWikimediaMultiQuery(title, summary, apiKey, sourceTitleHint);
    if (wikiPhoto) {
      const hosted = await rehostImage(wikiPhoto);
      if (hosted) return hosted;
      console.log(`  ⚠️  Wikimedia rehostImage failed — falling through to Unsplash/SVG`);
      // Do NOT return wikiPhoto raw — quality gate may have rejected it
    }
  }

  // ── Tier 4: Unsplash (optional) ───────────────────────────────────────────
  const unsplashKey = process.env.UNSPLASH_ACCESS_KEY;
  if (unsplashKey) {
    const unsplashResult = await fetchFromUnsplash(title, unsplashKey, category);
    if (unsplashResult) {
      const hosted = await rehostImage(unsplashResult);
      if (hosted) return hosted;
      // If rehostImage fails for Unsplash, fall through to SVG
    }
  }

  // ── Tier 4.5: AI-generated image via OpenRouter ──────────────────────────
  // Last resort before SVG. Generate a photorealistic editorial photo.
  if (apiKey) {
    const aiImage = await generateAiImage(title, category, summary, apiKey);
    if (aiImage) {
      console.log(`  🎨 AI-generated image: "${title.slice(0, 40)}"`);
      return aiImage;
    }
  }

  // ── Tier 5: null → caller generates category SVG ─────────────────────────
  // All real-photo attempts failed. SVG is always correct.
  return null;
}

/**
 * fetchFromWikimediaMultiQuery — AI-guided multi-query Wikimedia search.
 *
 * 1. Ask Gemini Flash to generate 5 diverse search queries (temperature=0.1)
 * 2. For each query, search Wikimedia Commons for landscape photos
 * 3. Filter out flags, maps, SVG icons, logos, diagrams
 * 4. Return the first qualifying image (largest × best aspect ratio)
 *
 * The 5-query approach solves the single-query failure modes:
 * - "Lebo M" → no results → try "Lebo M composer" → find Lion King concert photo
 * - "Indonesia" → flag → try "Prabowo Subianto" → find inauguration photo
 * - "cadmium food" → nothing → try "French food safety" → relevant image
 */
async function fetchFromWikimediaMultiQuery(
  title: string,
  summary: string,
  apiKey: string,
  sourceTitleHint?: string  // Optional English source title — used when story title is non-English
): Promise<string | null> {
  try {
    // ── Step 1: Generate 5 diverse Wikimedia search queries ────────────────
    //
    // Model: gemini-2.5-flash-preview (better contextual understanding than 2.0-flash)
    // Temperature: 0.1 (near-deterministic, consistent queries)
    //
    // Prompt design principles (v3.4.7):
    // - Prioritise CURRENT EVENT visuals (diplomatic meetings, protests, scenes)
    //   over ARCHIVAL/CEREMONIAL photos (award ceremonies, stock portraits)
    // - Named people must be paired with an action or context
    //   "Donald Trump Oval Office 2020" → bad (old archival)
    //   "Iran nuclear talks diplomacy" → good (event-focused)
    // - Location queries must be specific enough to return editorial photos
    //   "Iran" → returns flag. "Tehran street protest" → returns scene.
    // - Fallback queries broaden the concept without going abstract
    //
    const prompt = `You are an editorial photo researcher. Given a news story, suggest 5 Wikimedia Commons search queries that will find a relevant, current-looking editorial photograph.

CRITICAL RULES:
1. ⚠️ ALWAYS write ALL 5 queries in ENGLISH — even if the story title is in French, German, Spanish, Chinese, Russian, or any other language. Wikimedia Commons is indexed in English. Non-English queries return zero results.
2. Each query must be 2-5 words, specific and visual
3. Prioritise scenes and events over portraits and ceremonies
4. NEVER: country names alone ("Iran", "France"), abstract nouns ("diplomacy", "economy", "technology"), organisation names alone ("NATO", "UN", "EU")
5. Pair people with their CURRENT role or CURRENT action, not past events
6. Think: what would the front page of a newspaper show for this story?

Query strategy (generate one per type):
- Q1: The central scene or event in the story (what is actually happening?)
- Q2: The key person + their current role or action (not a ceremony or old headshot)
- Q3: The specific place where this is happening
- Q4: A physical object, document, or symbol central to the story
- Q5: A broader visual that represents the theme without being abstract

EXAMPLES:
Story: "Iran signals openness to nuclear talks" (English)
Good: ["Iran nuclear negotiations table", "Iranian foreign minister diplomacy", "Tehran government building", "nuclear agreement signing ceremony", "Middle East peace talks"]

Story: "Salahs Abschied von Liverpool" (German — but queries MUST be in English)
Good: ["Mohamed Salah Liverpool FC", "Anfield stadium crowd", "Premier League footballer", "Salah goal celebration", "Liverpool FC match"]

Story: "Горные гориллы-близнецы родились в Конго" (Russian — queries in English)
Good: ["mountain gorilla baby Virunga", "gorilla family forest", "Democratic Republic Congo wildlife", "endangered gorilla juvenile", "African rainforest primate"]

Story: "Le compositeur du Roi Lion poursuit un comédien" (French — queries in English)
Good: ["Lebo M Lion King composer", "copyright lawsuit music court", "Hans Zimmer Lion King concert", "South African musician stage", "Broadway musical performance"]

Return ONLY a valid JSON array of exactly 5 query strings. All in English. No explanations.

Title: "${title.slice(0, 120)}"${sourceTitleHint ? `\nEnglish source title (use this to understand the topic in English): "${sourceTitleHint.slice(0, 120)}"` : ""}
Summary: "${summary.slice(0, 300)}"`;

    const aiRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "HTTP-Referer": "https://cupof.news",
        "X-Title": "Cup of News",
      },
      body: JSON.stringify({
        // gemini-2.5-flash-preview: better instruction-following than 2.0-flash,
        // faster than 2.5-pro, cheap enough to run per-story
        model: "google/gemini-2.5-flash-preview",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 200,
        temperature: 0.1,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!aiRes.ok) {
      // Fallback to gemini-2.0-flash if 2.5-flash is unavailable
      console.warn(`  ⚠️  gemini-2.5-flash unavailable, falling back to 2.0-flash`);
      return fetchFromWikimediaMultiQueryFallback(title, summary, apiKey);
    }
    const aiData = await aiRes.json() as { choices: Array<{ message: { content: string } }> };
    const raw = aiData.choices?.[0]?.message?.content?.trim() ?? "";
    if (!raw) return null;

    // Parse queries — handle both ["q1","q2",...] and {"queries":["q1",...]}
    // Also handle markdown code fences that some models add
    let queries: string[] = [];
    try {
      const cleaned = raw.replace(/^```[a-z]*\n?/m, "").replace(/```$/m, "").trim();
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed)) queries = parsed;
      else for (const v of Object.values(parsed)) {
        if (Array.isArray(v)) { queries = v as string[]; break; }
      }
    } catch {
      // Last resort: extract quoted strings
      const matches = raw.match(/"([^"]{3,80})"/g);
      if (matches) queries = matches.map(m => m.slice(1, -1));
    }

    queries = queries.slice(0, 5).filter(q => typeof q === "string" && q.trim().length > 2);
    if (!queries.length) return null;

    console.log(`  🔍 Wikimedia queries for "${title.slice(0, 50)}": ${queries.join(" | ")}`);

    // ── Step 2: Try each query → vision relevance check (shared helper) ───
    // runQueriesWithVisionCheck: tries each query, passes candidate through
    // gemini-2.0-flash-lite vision check, returns first image scoring ≥5/10.
    return await runQueriesWithVisionCheck(queries, title, apiKey);

  } catch (err) {
    console.warn(`  ⚠️  fetchFromWikimediaMultiQuery error: ${err}`);
    return null;
  }
}

/**
 * checkImageRelevanceWithVision — pass a Wikimedia image URL to a vision model
 * and get a 0–10 relevance score for the given story headline.
 *
 * Model: google/gemini-2.0-flash-lite-001
 *   Cost: ~$0.075/M tokens. Each check is ~80 input tokens + ~30 output tokens.
 *   Cost per check: ~$0.000008. Cost per digest (up to 20 checks): ~$0.00016.
 *   Entirely negligible vs. the $0.07 Gemini 2.5 Pro digest cost.
 *
 * We use "detail: low" for the image — Gemini downscales to 512px.
 * Sufficient to identify whether it's a video game, museum diagram, or real news photo.
 * Latency: ~1.2–1.8s per check.
 *
 * Scoring:
 *   0   = video game screenshot, museum wall diagram, map, illustration, logo
 *   1-4 = real photo but completely unrelated to the story
 *   5-6 = tangentially related (same country, same general topic)
 *   7-9 = clearly relevant editorial photo
 *   10  = perfect (shows the exact event, person, or place in the headline)
 *
 * Accept threshold: score >= 7 (clearly relevant images only).
 * Fail-open: if the API errors or returns unparseable JSON, return 4 (skip).
 *   An SVG category placeholder is better than a wolf photo for a military story.
 *
 * @param imageUrl  - Wikimedia 1280px thumb URL
 * @param storyTitle - The story headline (used to judge relevance)
 * @param apiKey    - OpenRouter API key
 * @returns score 0–10
 */
async function checkImageRelevanceWithVision(
  imageUrl: string,
  storyTitle: string,
  apiKey: string
): Promise<number> {
  const VISION_PROMPT = `You are a strict photo editor at a major news publication. Your job is to REJECT images that would embarrass the publication.

Story headline: "${storyTitle.slice(0, 100)}"

GATE 1 — HARD REJECT (score 0) if ANY of these:
- Visible media outlet logo, watermark, chyron, or text overlay (BBC, Guardian, Reuters, AP, AFP, CNN, NYT, SCMP, Times, etc.) — even if the underlying photo is relevant
- Screenshot of a website, app, or software UI (shows browser chrome, navigation bars, menus, buttons, form fields, sidebars, or any computer interface elements)
- Video frame or broadcast TV screenshot (blurry, low-res still from a news broadcast or video, shows chyrons, lower-thirds, or has typical broadcast quality)
- Product screenshot or app demo screenshot used as if it were a news photograph
- Video game screenshot, CGI, or 3D render
- Museum exhibit, educational diagram, or anatomical chart
- Infographic, data chart, map, or illustration
- Historical painting, drawing, or artistic work
- Logo, icon, or graphic design
- Wildlife / nature photo (animals, plants, forests, landscapes) UNLESS the headline is directly about wildlife or nature
- Generic stock-looking photo (bokeh backgrounds, autumn leaves, abstract textures)
- Unrelated person, building, or scene with no connection to the headline
- Wildlife, nature, or animal photos UNLESS the story is explicitly about wildlife/nature/animals
- Abstract art, light patterns, bokeh, geometric shapes, prisms
- Generic stock-photo scenes (couple walking, hands shaking, person at laptop) with no specific connection to the headline
- Scientific visualizations or diagrams UNLESS the story is about that specific scientific topic
- Sports action photos used for non-sports stories
- Architectural/building exterior photos used for political/person stories

GATE 2 — Score ONLY if Gate 1 passed:
Score 8-10: directly shows the specific event, person, place, or object in the headline
Score 7: clearly related — right country, right organization, right topic
Score 4-6: vaguely related — same broad theme but could illustrate any story
Score 0-3: misleading or wrong even if it is a real photo

Threshold: only scores 7+ are accepted. Be harsh. If unsure, score 4.

Return ONLY valid JSON, no markdown:
{"is_photo": true/false, "score": 0-10, "reason": "one line"}`;

  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "HTTP-Referer": "https://cupof.news",
        "X-Title": "Cup of News",
      },
      body: JSON.stringify({
        model: "google/gemini-2.0-flash-001",  // flash (not lite) — better relevance judgment
        messages: [{
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: {
                url: imageUrl,
                detail: "low",  // 512px resolution — sufficient, fast, cheap
              },
            },
            { type: "text", text: VISION_PROMPT },
          ],
        }],
        max_tokens: 80,
        temperature: 0,  // deterministic — same image always gets same score
      }),
      signal: AbortSignal.timeout(8_000),  // 8s max — vision is fast
    });

    if (!res.ok) {
      // 400 = image URL is invalid/unreachable by the vision API
      // Treat as rejection — a broken image URL is not a valid candidate
      if (res.status === 400) {
        console.warn(`  ⚠️  Vision check: image URL rejected by API (${res.status}) — skipping`);
        return 0;
      }
      // Other API errors (429, 500, etc.) — fail closed (skip) to avoid bad images
      console.warn(`  ⚠️  Vision check API error ${res.status} — skipping image (fail closed)`);
      return 4;
    }

    const data = await res.json() as { choices: Array<{ message: { content: string } }> };
    const raw = (data.choices?.[0]?.message?.content ?? "").trim()
      .replace(/^\`\`\`json\s*/m, "").replace(/\`\`\`$/m, "").trim();

    // Try to parse structured JSON first
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}") + 1;
    if (start >= 0 && end > start) {
      try {
        const result = JSON.parse(raw.slice(start, end)) as {
          is_photo?: boolean;
          score?: number;
          verdict?: string;
        };
        const score = typeof result.score === "number" ? result.score : 4;  // unknown = skip
        const isPhoto = result.is_photo !== false;
        if (!isPhoto) return 0;
        return score;
      } catch { /* fall through to prose parsing */ }
    }

    // Prose response fallback — model gave a description instead of JSON.
    // This typically means the model is uncertain or the image is unusual.
    // Parse key signals from the text.
    const lower = raw.toLowerCase();

    // Strong rejection signals in prose
    const rejectSignals = [
      "political cartoon", "cartoon", "illustration", "drawing", "diagram",
      "poster", "infographic", "painting", "screenshot", "video game",
      "scientific illustration", "anatomical", "museum", "not a photograph",
      "not real", "not relevant", "unrelated", "reject",
    ];
    const acceptSignals = [
      "photograph", "news photo", "real photo", "editorial", "accept",
      "relevant", "appropriate", "shows the", "depicts the",
    ];

    const rejectCount = rejectSignals.filter(s => lower.includes(s)).length;
    const acceptCount = acceptSignals.filter(s => lower.includes(s)).length;

    if (rejectCount > acceptCount) {
      console.warn(`  ⚠️  Vision check prose → reject (${rejectCount} reject signals)`);
      return 1;
    }

    // No clear signal — skip (better to use SVG fallback than a wrong photo)
    console.warn(`  ⚠️  Vision check prose → skip (${acceptCount} accept / ${rejectCount} reject signals)`);
    return 4;

  } catch (err) {
    // Network error, timeout — fail closed (skip this image)
    console.warn(`  ⚠️  Vision check exception — skipping image: ${err}`);
    return 4;
  }
}

/**
 * Fallback query generation using gemini-2.0-flash-001.
 * Used when gemini-2.5-flash-preview is unavailable.
 */
async function fetchFromWikimediaMultiQueryFallback(
  title: string,
  summary: string,
  apiKey: string
): Promise<string | null> {
  try {
    const prompt = `Generate 5 Wikimedia Commons search queries for this news story. Return ONLY a JSON array of 5 strings. Each query: 2-5 words, specific and visual, no country names alone.
Title: "${title.slice(0, 120)}"
Context: "${summary.slice(0, 150)}"`;

    const aiRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "HTTP-Referer": "https://cupof.news",
        "X-Title": "Cup of News",
      },
      body: JSON.stringify({
        model: "google/gemini-2.0-flash-001",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 150,
        temperature: 0.1,
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!aiRes.ok) return null;
    const aiData = await aiRes.json() as { choices: Array<{ message: { content: string } }> };
    const raw = aiData.choices?.[0]?.message?.content ?? "";
    let queries: string[] = [];
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) queries = parsed;
      else for (const v of Object.values(parsed)) {
        if (Array.isArray(v)) { queries = v as string[]; break; }
      }
    } catch { return null; }
    queries = queries.slice(0, 5).filter(q => typeof q === "string" && q.length > 2);
    // Same vision-checked loop as the main function — reject diagrams, screenshots, etc.
    return await runQueriesWithVisionCheck(queries, title, apiKey);
  } catch {
    return null;
  }
}

/**
 * runQueriesWithVisionCheck — shared helper used by both query generators.
 * Tries each query against Wikimedia, vision-checks each candidate, returns
 * the first image that passes. Returns null if all 5 fail.
 */
async function runQueriesWithVisionCheck(
  queries: string[],
  title: string,
  apiKey: string
): Promise<string | null> {
  for (const query of queries) {
    const img = await wikimediaBestPhoto(query);
    if (!img) continue;
    const visionScore = await checkImageRelevanceWithVision(img, title, apiKey);
    if (visionScore >= 7) {
      console.log(`  ✅ Vision check passed (score ${visionScore}/10) for: "${query}"`);
      return img;
    } else {
      console.log(`  🚫 Vision check failed (score ${visionScore}/10) — skipping: "${query}"`);
    }
  }
  console.log(`  ⚠️  All queries failed vision check for: "${title.slice(0, 50)}" — will use category SVG`);
  return null;
}

/**
 * wikimediaBestPhoto — search Wikimedia Commons, return best landscape photo.
 *
 * v3.4.7 improvements:
 * - Extended BAD filter: rejects award ceremonies, official portraits, stamps,
 *   coat-of-arms, historical/archival patterns by filename
 * - Uses Wikimedia thumb API to return a 1280px-wide resized URL instead of
 *   the original multi-MB file. This loads 10-20× faster in the browser.
 * - Min ratio raised to 1.5 (true landscape — avoids 4:3 near-square crops)
 * - Score now uses index (position in relevance results) as a tiebreaker:
 *   first result from Wikimedia search is most semantically relevant
 */
async function wikimediaBestPhoto(query: string): Promise<string | null> {
  try {
    const apiUrl = `https://commons.wikimedia.org/w/api.php?` +
      `action=query&format=json&origin=*` +
      `&generator=search&gsrsearch=${encodeURIComponent(query)}` +
      `&gsrnamespace=6&gsrlimit=12&gsrsort=relevance` +
      `&prop=imageinfo&iiprop=url|size|mime|canonicaltitle`;

    const res = await fetch(apiUrl, {
      headers: { "User-Agent": "CupOfNews/3.4 (https://cupof.news; editorial digest)" },
      signal: AbortSignal.timeout(7_000),
    });
    if (!res.ok) return null;

    const data = await res.json() as {
      query?: { pages?: Record<string, {
        index?: number;
        imageinfo?: Array<{ url: string; width: number; height: number; mime: string; canonicaltitle?: string }>
      }> }
    };

    // Filename patterns that reliably indicate non-editorial content
    const BAD_PATTERNS = [
      // Flags, emblems, seals
      "flag_","Flag_","Emblem_","_emblem","Seal_of","seal_of","coat_of","Coat_of",
      // Maps, diagrams
      "Map_","_map","Map_of","_Map","Diagram","diagram","chart_","_chart",
      // Logos, icons
      "_logo","Logo_","_icon","Icon_","symbol_","Symbol_",
      // Non-editorial
      "stamp_","Stamp_","currency","Currency","blank_","Blank_",
      "outline_","silhouette","pictogram","Pictogram",
      // Award ceremonies, portraits (often misleading for news)
      "official_portrait","Official_portrait","_official_","Presidential_portrait",
      // Historical/archival (year patterns in filename = old photo)
      // Note: we don't block all years — just obvious archive collections
      "Library_of_Congress","Bundesarchiv","vintage_","Victorian_",
      // Military/defense photo agencies — DVIDS = Defense Visual Info Distribution Service
      // These are US military stock photos, almost never relevant to civilian news
      "DVIDS","_DVIDS",
      // Data visualisations and statistics (usually PNG diagrams)
      "Datenvisualisierung","data_visualization","infographic","_graph","transported_per",
    ];

    // Filename patterns in the URL that suggest this is a better contemporary photo
    // (not enforced as hard rules, just used in scoring)

    type Candidate = { score: number; url: string; index: number };
    const candidates: Candidate[] = [];
    const pages = data.query?.pages ?? {};

    for (const page of Object.values(pages)) {
      const info = page.imageinfo?.[0];
      if (!info) continue;
      // Only JPEG and WebP — real editorial photographs are never PNG
      // PNG = data charts, maps, diagrams, infographics. Hard reject.
      if (!["image/jpeg","image/webp"].includes(info.mime)) continue;
      const isPng = false; // always false now — PNG rejected above

      const w = info.width ?? 0, h = info.height ?? 0;
      if (w < 800 || h < 400) continue; // min 800px wide for editorial quality

      const ratio = w / Math.max(h, 1);
      if (ratio < 1.45 || ratio > 3.0) continue; // true landscape, not too wide

      if (info.url.includes(".svg")) continue;

      const urlLower = info.url.toLowerCase();
      if (BAD_PATTERNS.some(b => info.url.includes(b))) continue;
      if (!isValidOgImage(info.url)) continue;

      // Score components:
      // ratioScore: proximity to 16:9 (1.778)
      const ratioScore = Math.max(0, 1 - Math.abs(ratio - 1.778) * 1.2);
      // sizeScore: bigger = better, capped at 8MP
      const sizeScore = Math.min(w * h, 8_000_000) / 8_000_000;
      // sizeBonus: editorial minimum quality
      const sizeBonus = w >= 1280 ? 0.15 : (w >= 800 ? 0.05 : 0);
      // indexBonus: Wikimedia relevance rank — first result is most relevant
      const indexRank = page.index ?? 99;
      const indexBonus = Math.max(0, (12 - indexRank) / 12) * 0.15;

      // PNG penalty: data charts, stats diagrams are usually PNG; real editorial photos are JPEG/WebP
      const pngPenalty = isPng ? 0.25 : 0;
      const score = (ratioScore * 0.45 + sizeScore * 0.25 + sizeBonus * 0.15 + indexBonus * 0.15) - pngPenalty;
      candidates.push({ score, url: info.url, index: indexRank });
    }

    if (!candidates.length) return null;

    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];

    // Convert to Wikimedia thumb URL (1280px wide) for fast browser loading
    // Original: https://upload.wikimedia.org/wikipedia/commons/4/4f/Filename.jpg
    // Thumb:    https://upload.wikimedia.org/wikipedia/commons/thumb/4/4f/Filename.jpg/1280px-Filename.jpg
    const thumbUrl = wikimediaThumbUrl(best.url, 1280);
    return thumbUrl ?? best.url;

  } catch {
    return null;
  }
}

/**
 * Convert a Wikimedia Commons original URL to a thumbnail URL at the given width.
 * Wikimedia's thumb service resizes on-the-fly and caches the result.
 * This is the standard way to serve Wikimedia images efficiently.
 *
 * Input:  https://upload.wikimedia.org/wikipedia/commons/4/4f/Filename.jpg
 * Output: https://upload.wikimedia.org/wikipedia/commons/thumb/4/4f/Filename.jpg/1280px-Filename.jpg
 */
function wikimediaThumbUrl(originalUrl: string, width: number): string | null {
  try {
    // Match: /wikipedia/commons/X/XX/Filename.ext
    const match = originalUrl.match(/\/wikipedia\/(commons(?:\/[^/]+)?)\/([0-9a-f])\/([0-9a-f]{2})\/(.+)$/i);
    if (!match) return null;
    const [, repo, h1, h2, filename] = match;
    const ext = filename.split(".").pop()?.toLowerCase();
    if (!ext || ["svg","tiff","tif","pdf","ogg","ogv","webm"].includes(ext)) return null;
    return `https://upload.wikimedia.org/wikipedia/${repo}/thumb/${h1}/${h2}/${filename}/${width}px-${filename}`;
  } catch {
    return null;
  }
}


/** Unsplash search — requires UNSPLASH_ACCESS_KEY */
async function fetchFromUnsplash(title: string, accessKey: string, category = "World"): Promise<string | null> {
  const query = buildImageQuery(title, category);
  try {
    const res = await fetch(
      `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=3&orientation=landscape&content_filter=high`,
      {
        headers: { Authorization: `Client-ID ${accessKey}`, "Accept-Version": "v1" },
        signal: AbortSignal.timeout(6000),
      }
    );
    if (!res.ok) return null;
    const data = await res.json() as { results: Array<{ urls: { regular: string } }> };
    const photo = data.results?.[0]?.urls?.regular;
    return photo && isValidOgImage(photo) ? photo : null;
  } catch { return null; }
}

/**
 * Wikimedia Commons image search.
 * Uses the MediaWiki API (no auth required) to find freely licensed photos.
 * Filters to images with landscape-friendly aspect ratios.
 */
async function fetchFromWikimedia(title: string, category: string): Promise<string | null> {
  const query = buildImageQuery(title, category) || category;
  try {
    const apiUrl = `https://commons.wikimedia.org/w/api.php?` +
      `action=query&format=json&origin=*` +
      `&generator=search&gsrsearch=File:${encodeURIComponent(query)}&gsrnamespace=6&gsrlimit=5` +
      `&prop=imageinfo&iiprop=url|size|mime`;

    const res = await fetch(apiUrl, {
      headers: { "User-Agent": "CupOfNews/2.1 (https://cupof.news; editorial digest)" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;

    const data = await res.json() as {
      query?: { pages?: Record<string, {
        imageinfo?: Array<{ url: string; width: number; height: number; mime: string }>
      }> }
    };

    const pages = Object.values(data.query?.pages ?? {});
    for (const page of pages) {
      const info = page.imageinfo?.[0];
      if (!info) continue;
      if (!["image/jpeg", "image/png", "image/webp"].includes(info.mime)) continue;
      // Prefer landscape images (width > height)
      if (info.width < info.height) continue;
      if (info.width < 600) continue; // Too small — enforce reasonable resolution
      if (info.width < info.height * 1.1) continue; // Must be clearly landscape
      if (isValidOgImage(info.url)) return info.url;
    }
    return null;
  } catch { return null; }
}

/**
 * buildImageQuery — extract the most photo-searchable keywords from a story.
 *
 * v2.3.0: Category-aware query construction.
 *
 * The key insight: for news photos, the best search terms are:
 *   - Named entities (countries, cities, people, organisations) → visual subjects
 *   - Category-specific terms → immediately grounding the photo
 *
 * PROBLEM WITH GENERIC KEYWORD EXTRACTION:
 *   "US and Iran trade threats over nuclear programme" → "iran nuclear programme threats"
 *   → Wikimedia returns diagrams, maps, protest photos — rarely a sharp news photo.
 *
 * BETTER APPROACH:
 *   1. Extract named-entity candidates (words starting with uppercase in mid-sentence,
 *      or from a known country/city list) — these produce the most photo-searchable results
 *   2. Add a category-specific anchor term (e.g. "stadium" for Sports, "parliament" for
 *      Politics) — this biases Wikimedia toward the right visual domain
 *   3. Fall back to stop-word-filtered title keywords if no named entities found
 *
 * WHY CATEGORY ANCHORS HELP:
 *   "Man City crushes Arsenal" → "Manchester City Arsenal" + "football" → stadium/match photos
 *   "Bundesliga result" → "Bundesliga" + "football" → actual match photography
 *   "French election" → "France election" + "parliament" → political imagery
 */
function buildImageQuery(title: string, category = "World"): string {
  // Category-specific anchor terms that bias photo searches toward the right domain
  const categoryAnchors: Record<string, string> = {
    Sports:      "sport",
    Politics:    "government",
    Business:    "economy",
    Technology:  "technology",
    Science:     "research",
    Health:      "health",
    Environment: "nature",
    Culture:     "culture",
    World:       "",
    Other:       "",
  };

  const STOP = new Set([
    // English
    "a","an","the","and","or","but","in","on","at","to","for","of","with","by",
    "from","is","it","its","this","that","was","are","be","has","had","have",
    "will","would","could","should","may","might","over","than","then","so",
    "if","when","where","how","what","who","why","says","said","after","before",
    "new","first","last","more","most","also","into","does","as","up","amid",
    "deal","plan","call","move","hit","warn","seek","face","hold","set","push",
    "amid","amid","amid","us","un","eu","nato","two","three","four","five",
    // French
    "le","la","les","un","une","des","du","de","et","ou","dans","sur","avec",
    "par","pour","que","qui","il","elle","au","aux","ce","son","sa","ses",
    // German
    "der","die","das","ein","eine","und","oder","aber","auf","an","mit","von",
    "zu","bei","nach","aus","sich","ist","war","hat","für","des","im","am",
  ]);

  // Extract capitalised words from the middle of the title (likely named entities)
  const words = title.split(/\s+/);
  const namedEntities = words
    .slice(1) // Skip first word (always capitalised)
    .filter(w => /^[A-ZÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖÙÚÛÜÝÞŸ]/.test(w))
    .map(w => w.replace(/[^a-zA-ZÀ-ÿ]/g, ""))
    .filter(w => w.length > 2 && !STOP.has(w.toLowerCase()))
    .slice(0, 3);

  // If we found named entities, use them as the primary query
  if (namedEntities.length >= 2) {
    const anchor = categoryAnchors[category] || "";
    const q = namedEntities.join(" ") + (anchor ? " " + anchor : "");
    return q.trim();
  }

  // Fallback: stop-word-filtered keywords + category anchor
  const keywords = title
    .toLowerCase()
    .replace(/[^\w\sÀ-ɏ]/g, " ")
    .split(/\s+/)
    .filter(w => w.length >= 4 && !STOP.has(w))
    .slice(0, 3);

  const anchor = categoryAnchors[category] || "";
  return (keywords.join(" ") + (anchor ? " " + anchor : "")).trim() || category;
}


async function extractViaJina(
  url: string
): Promise<{ text: string; title: string; ogImage: string | null }> {
  const jinaUrl = `${JINA_PREFIX}${url}`;
  // 20s timeout per Jina request — Jina rate-limits aggressively; hanging forever makes the pipeline stall
  const jinaCtrl = new AbortController();
  const jinaTimeout = setTimeout(() => jinaCtrl.abort(), 20_000);
  const res = await fetch(jinaUrl, {
    signal: jinaCtrl.signal,
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
    max_tokens: 24000,
  });

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "HTTP-Referer": "https://github.com/paulfxyz/cup-of-news",
    "X-Title": "Cup of News",
  };

  // Attempt 1 — 150s timeout (Gemini 2.5 Pro can take 60-120s for large prompts)
  const makeRequest = async () => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 240_000);  // 4 min — Gemini 2.5 Pro can take 3-4 min under load
    try {
      return await fetch(OPENROUTER_API_URL, { method: "POST", headers, body, signal: ctrl.signal });
    } finally {
      clearTimeout(t);
    }
  };

  let res = await makeRequest();

  // Single retry on rate-limit or server error
  if ((res.status === 429 || res.status >= 500) && res.status !== 401) {
    console.warn(`⚠️  OpenRouter ${res.status} — retrying in 2s…`);
    await new Promise((r) => setTimeout(r, 2000));
    res = await makeRequest();
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
 * enrichStorySources — ensure every story has at least 3 sources.
 *
 * v2.1.1: MANDATORY 3-SOURCE RULE
 *
 * WHY THIS EXISTS:
 *   The AI assigns sources via additionalIdxs[], but only does so when it
 *   recognises multiple articles covering the SAME news event. For unique
 *   stories (single RSS source), the AI correctly returns additionalIdxs=[]
 *   — giving the story only 1 source.
 *
 *   The user requirement is clear: every story must have at least 3 sources.
 *   The correct approach is a post-processing enrichment step that finds the
 *   best-matching articles from the full content pool using keyword overlap,
 *   rather than a second AI call (too expensive) or forcing the AI to invent
 *   sources (hallucination risk).
 *
 * ALGORITHM:
 *   1. For each story with < 3 sources, extract keywords from its title
 *      (stop-word filtered, 4+ char words)
 *   2. Score every unused article in allProcessed by keyword overlap
 *      (Jaccard similarity on title word sets)
 *   3. Pick the top-scoring articles (minimum score threshold = 1 shared word)
 *   4. Add them as additional sources up to the 3-source minimum
 *   5. If still < 3 sources after keyword matching, pad with the highest-scored
 *      articles from the same category (topical relevance > no source)
 *
 * DESIGN DECISIONS:
 *   - We pad to exactly 3 sources, not more. The UI shows "3 Sources" — more
 *     would just be noise unless they're genuinely relevant.
 *   - We track which article indices are already used as primary sources to
 *     avoid the same URL appearing twice.
 *   - No hallucination: we only add sources from articles we actually received
 *     and processed. Every URL we add was fetched and is real.
 *   - The function is synchronous and fast (string ops only, no network calls).
 *
 * COUNTER-ARGUMENT / AUDIT:
 *   One could argue that adding a loosely-related source is misleading —
 *   the source didn't literally cover this exact story. Counter: the user
 *   explicitly requested multi-source verification as a product feature.
 *   The sources modal UI says "also covered related angles" implicitly.
 *   For true isolated stories (rare Antarctica research, niche culture), the
 *   keyword matching will find topically-adjacent sources (other science/culture
 *   articles) which is genuinely valuable context for the reader.
 */
function enrichStorySources(
  stories: DigestStory[],
  allProcessed: Array<{ link: { url: string; id: number }; title: string; text: string }>
): void {
  // Build lookup: url → already used as primary source (to avoid dupe URLs)
  const usedUrls = new Set(stories.map(s => s.sourceUrl));

  // Stop words for keyword extraction
  const STOP = new Set([
    "a","an","the","and","or","but","in","on","at","to","for","of","with","by",
    "from","is","it","its","this","that","was","are","be","has","had","have",
    "will","would","could","should","may","might","over","than","then","so",
    "if","when","where","how","what","who","why","says","said","after","before",
    "new","first","last","more","most","also","than","into","does","as","up",
    "us","un","eu","not","can","all","one","two","three","but","our","their",
    // French
    "le","la","les","un","une","des","du","de","et","ou","dans","sur","avec",
    "par","pour","que","qui","il","elle","ils","elles","ce","son","sa","ses",
    // German
    "der","die","das","ein","eine","und","oder","aber","auf","an","mit","von",
    "zu","bei","nach","aus","sich","ist","war","hat","werden","auch","für",
  ]);

  function keywords(text: string): Set<string> {
    return new Set(
      text.toLowerCase()
        .replace(/[^\w\sÀ-ɏ]/g, " ")
        .split(/\s+/)
        .filter(w => w.length >= 4 && !STOP.has(w))
    );
  }

  function jaccardScore(a: Set<string>, b: Set<string>): number {
    // Use Array.from() for Set iteration — required for TypeScript downlevel targets
    let shared = 0;
    Array.from(a).forEach(w => { if (b.has(w)) shared++; });
    const union = a.size + b.size - shared;
    return union === 0 ? 0 : shared / union;
  }

  for (const story of stories) {
    if ((story.sources?.length ?? 0) >= 4) continue; // Already has enough

    const storyKw = keywords(story.title + " " + story.summary);
    // Target 4 sources. The AI will have assigned 1-3 via additionalIdxs.
    // We pad to 4. Keyword-matched sources are more relevant than random ones,
    // so we score all candidates and pick the best available.
    const needed = 4 - (story.sources?.length ?? 0);

    // Score all articles NOT already used as a source for this story
    const storySourceUrls = new Set((story.sources ?? []).map(s => s.url));

    const candidates = allProcessed
      .filter(p => !storySourceUrls.has(p.link.url))
      .map(p => ({
        url: p.link.url,
        title: p.title || p.link.url,
        domain: (() => { try { return new URL(p.link.url).hostname.replace("www.",""); } catch { return p.link.url; } })(),
        score: jaccardScore(storyKw, keywords(p.title)),
      }))
      .filter(c => c.score > 0) // Must share at least 1 meaningful word
      .sort((a, b) => b.score - a.score);

    // Add best-matching candidates only — never pad with unrelated articles.
    //
    // v2.2.0 BUG FIX: the previous version had a "topical fallback" that took the
    // first N articles from allProcessed when Jaccard found no keyword matches.
    // allProcessed[0..N] are the first RSS articles fetched — completely unrelated
    // to the story. This caused "sources from story #1 appearing on story #15."
    //
    // Correct behaviour: if we can't find a genuinely matching article for a source
    // slot, leave the slot empty. A story with 2 genuine sources is better than a
    // story with 4 where 2 are misleading noise.
    //
    // The minimum is now enforced by having diverse RSS pools — if there are 60+
    // articles in the pool covering global news, Jaccard will find keyword matches
    // for almost every story. The only exception is highly niche topics (a specific
    // local election, a rare science paper) where we rightly show fewer sources.
    const added = candidates.slice(0, needed);

    // Append to story sources (genuine matches only)
    if (!story.sources) story.sources = [];
    for (const c of added) {
      story.sources.push({ url: c.url, title: c.title, domain: c.domain });
    }
  }
}

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
  apiKey: string,
  editionId = "en"
): Promise<{ digestId: number; storiesCount: number; edition: string }> {
  const today = getTodayDate();
  const edition = getEdition(editionId);

  console.log(`☕ Generating digest for edition: ${edition.flag} ${edition.name} (${editionId})`);

  // Block regeneration ONLY if THIS edition's digest is already published.
  // v2.0.3 fix: must pass editionId to getDigestByDate.
  // Previous bug: called getDigestByDate(today) with no edition — defaulted to
  // "en-WORLD" — so generating ANY edition after en-WORLD was published would
  // throw "Published digest already exists" even for editions with no digest.
  const existing = storage.getDigestByDate(today, editionId);
  if (existing?.status === "published") {
    throw new Error(
      `Published digest already exists for ${today} / ${editionId}. Unpublish it first to regenerate.`
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
    ? `\n\nREADER PROFILE & EDITORIAL LENS (high priority — let this shape selection and tone):\n${editorialPrompt.trim()}`
    : "";

  // ── v2.1.0: Language + regional injection ──────────────────────────────────
  //
  // WHY LANGUAGE INSTRUCTION COMES FIRST:
  //   Gemini 2.5 Pro (and all LLMs) follow early-prompt instructions more
  //   reliably than late-prompt ones. If language is buried at the end of a
  //   600-token system prompt, the model often defaults to English.
  //   Solution: language constraint appears in the FIRST paragraph.
  //
  // DUAL-LANGUAGE REINFORCEMENT:
  //   "Write in French (Écrivez en français)" outperforms either alone.
  //   English ensures the model parses the instruction; native-language
  //   reinforcement activates the model's native-language generation pathways.
  //
  // EXPLICIT FIELD-BY-FIELD ENUMERATION:
  //   Early versions said "write in French" but the model would write
  //   summaries in French while leaving titles in English (or vice versa).
  //   Listing each JSON field explicitly closes that gap.
  const isNonEnglish = edition.language !== "en";
  const categoryValues = Object.values(edition.categories).join(" | ");

  const languageBlock = isNonEnglish ? `
⚠️  LANGUAGE — THE SINGLE MOST IMPORTANT RULE IN THIS ENTIRE PROMPT:
${edition.aiLanguageInstruction}

YOU MUST write EVERY output field in ${edition.languageName}:
• "title"              → in ${edition.languageName}
• "summary"            → in ${edition.languageName}
• "closingQuote"       → in ${edition.languageName}
• "closingQuoteAuthor" → keep the person's name, add role in ${edition.languageName}
• "category"           → EXACTLY one of: ${categoryValues}

❌ DO NOT write any field in English. Zero English words in titles or summaries.
✅ This is the ${edition.name} edition. Readers expect ${edition.languageName}.
` : "";

  // Edition independence block — critical for non-English editions.
  // Without this, the AI treats all editions as "world news in X language"
  // and selects the same Reuters/BBC/NYT wire stories as the English edition,
  // just translated. The goal is DIFFERENT stories, not translations.
  const editionIndependenceBlock = isNonEnglish ? `
🚨 EDITION INDEPENDENCE — THIS IS NOT THE ENGLISH EDITION:
This is the ${edition.name} edition for ${edition.languageName}-speaking readers.
Your stories MUST be DIFFERENT from what the English World edition would show.

MANDATORY RULES FOR THIS EDITION:
• PREFER stories from ${edition.languageName}-language sources (native journalism, not wire services)
• PRIORITISE stories that ${edition.languageName}-speaking readers care about most — regional politics, their sports leagues, their cultural events
• AVOID selecting the exact same major wire stories (Reuters, AP, AFP, BBC, NYT) that would dominate the English edition
• AT LEAST 8 of your 20 stories must be on topics NOT primarily driven by Anglophone media
• The ${edition.name} edition should feel like reading a DIFFERENT newspaper, not a translation of the English one

NATIVE PERSPECTIVE: Frame stories through the lens of ${edition.languageName}-speaking society. What does this event mean for readers in ${edition.name.split(' ')[0]} or nearby regions?` : "";

  const regionalBlock = `🌍 EDITION: ${edition.flag} ${edition.name} (${editionId})
REGIONAL FOCUS: ${edition.aiRegionalFocus}
${editionIndependenceBlock}`;

    // v2.2.0: use the edition's own aiSportSlot
  const sportSlot = edition.aiSportSlot;

  const systemPrompt = `You are the editorial AI for "Cup of News" — a curated morning news digest inspired by The Economist Espresso. Your writing is intelligent, slightly opinionated, and respects the reader's time.
${languageBlock}
${regionalBlock}
${editorialSection}

EDITORIAL MANDATE — BREADTH IS NON-NEGOTIABLE:
You are the editor of a world briefing read at breakfast. A reader should finish feeling they understand TODAY'S WORLD — not just one corner of it.

HARD LIMITS — breaking any of these means the digest has FAILED:
- MAX 2 stories about any single ongoing conflict or crisis (Iran/Israel = 2 max, then STOP — pick 2 best angles only)
- MAX 2 stories involving the same country (includes stories that are primarily about that country)
- MAX 2 stories with the same person, company, or institution as the primary subject
- MAX 3 stories in any single category
- If multiple articles cover the SAME NEWS EVENT from different outlets — do NOT treat them as separate stories. Group them using additionalIdxs (multi-source) instead. One story, multiple perspectives.

MANDATORY TOPIC SLOTS — your 20 stories MUST include ALL of the following:
✦ AT LEAST 2 Technology or Science stories (AI, medical research, space, climate tech)
✦ AT LEAST 2 Business or Economics stories (markets, central banks, trade, M&A, earnings)
✦ AT LEAST 2 Sports stories — specifically: ${sportSlot}
✦ AT LEAST 1 Culture story (film, music, art, books, fashion, theatre, food)
✦ AT LEAST 1 Health or Environment story (medicine, climate, biodiversity, food systems)

MANDATORY GEOGRAPHIC DIVERSITY — 20 stories, 20 different angles on the world:
✦ AT LEAST 2 stories from SUB-SAHARAN AFRICA (Nigeria, Kenya, South Africa, Ethiopia, Ghana, Senegal — NOT North Africa)
✦ AT LEAST 2 stories from ASIA-PACIFIC (Japan, India, China, South Korea, SE Asia, Australia, Pacific — NOT Middle East)
✦ AT LEAST 2 stories from THE AMERICAS (USA, Canada, Brazil, Mexico, Argentina, Colombia, Chile — any region)
✦ AT LEAST 2 stories from EUROPE (EU institutions, UK, Germany, France, Italy, Spain, Nordics, Eastern Europe)
✦ AT LEAST 1 story from THE MIDDLE EAST / NORTH AFRICA (Jordan, Saudi Arabia, Turkey, Egypt, Morocco — beyond just Iran/Israel)
✦ AT LEAST 1 story from SOUTH ASIA (India, Pakistan, Bangladesh, Sri Lanka)
✦ AT LEAST 1 story from CENTRAL ASIA or EASTERN EUROPE (Ukraine, Georgia, Kazakhstan, Uzbekistan etc.)

GEOGRAPHIC HARD LIMITS:
✗ MAX 1 story per country (e.g. only 1 USA story, only 1 France story, only 1 China story)
✗ MAX 2 stories from any single geographic region
✗ MAX 2 stories on the Iran/Israel/Gaza conflict specifically — pick the 2 most newsworthy angles only
✗ NO story where the same country appears as protagonist in 2 separate entries

SELF-CHECK BEFORE SUBMITTING:
List each story's primary country. If any country appears more than once, replace the duplicate.
Count stories per region. If any region has 3+, replace the extra with an underrepresented region.
Aim for: every continent represented, no dominant narrative, a reader finishes knowing what's happening EVERYWHERE.

QUALITY:
- Each summary: EXACTLY 2 paragraphs separated by a blank line (\n\n). Each paragraph: 50-70 words.
  P1 = What happened — the core facts, who, what, where, when. 2-3 sentences.
  P2 = Why it matters — context, significance, implications, what to watch. 2-3 sentences.
  Active voice. Editorial confidence. No hedging. No "experts say". Total: 100-140 words.
- Headlines: specific and informative, not clickbait
- ALL OUTPUT TEXT MUST BE IN ${edition.languageName.toUpperCase()} — this is the ${edition.name} edition
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
      "summary": "<EXACTLY 2 paragraphs separated by \\n\\n. P1: what happened (50-70 words). P2: why it matters (50-70 words). Active voice, no hedging.>",
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

  // Use async map via Promise.all — required because OG dimension check (Phase 2)
  // fetches image headers asynchronously. We can't use await inside .map() directly.
  // All 20 dimension checks run in parallel (they each fetch 1KB), so latency is ~200ms total.
  const storiesRaw: Array<DigestStory | null> = await Promise.all(
    aiResult.stories
      .slice(0, 20)
      .map(async (s: any): Promise<DigestStory | null> => {
        // Guard against AI returning out-of-bounds idx
        const original = allProcessed[s.idx - 1];
        if (!original) {
          console.warn(`⚠️  AI returned idx ${s.idx} but only ${allProcessed.length} items exist`);
          return null;
        }

        // Image: use OG only if it passes validation, otherwise mark for generation
        // Phase 1: URL pattern check (fast, synchronous)
        let ogValid = isValidOgImage(original.ogImage || null);

        // Phase 2: Actual dimension check — reject portrait images that slipped through URL pattern
        // e.g. Reuters/AP/AFP CDN images that are portrait but have neutral CDN URLs
        // Fetches only 1KB (Range: bytes=0-1023) — negligible overhead, all 20 run in parallel
        if (ogValid && original.ogImage) {
          const dims = await getImageDimensions(original.ogImage);
          if (dims) {
            const ratio = dims.w / dims.h;
            // Reject if: portrait (ratio < 1.3) OR too small (w < 600 or h < 300)
            // 1.3 minimum allows 4:3 (ratio 1.33) but blocks near-square and portrait
            // 600×300 minimum matches the rehostImage gate — no point sending tiny images through
            if (ratio < 1.3 || dims.w < 600 || dims.h < 300) {
              console.log(`  🚫 OG rejected by dims: ${dims.w}x${dims.h} (ratio ${ratio.toFixed(2)}) — ${original.ogImage?.substring(0, 80)}`);
              ogValid = false;
            }
          }
        }

        // Phase 3: Vision check — reject branded overlays, logos, watermarks
        if (ogValid && original.ogImage) {
          const ogVisionScore = await checkImageRelevanceWithVision(original.ogImage, s.title, apiKey);
          if (ogVisionScore < 7) {
            console.log(`  🚫 OG vision check failed (score ${ogVisionScore}/10) — ${original.ogImage?.substring(0, 80)}`);
            ogValid = false;
          }
        }

        // If OG is valid, rehost as WebP immediately (async, but inside Promise.all)
        let imageUrl: string;
        if (ogValid && original.ogImage) {
          const hosted = await rehostImage(original.ogImage);
          imageUrl = hosted ?? original.ogImage;  // use hosted WebP, fallback to original
        } else {
          // Encode sourceUrl into the marker so needsGeneration loop can use it
          imageUrl = `__GENERATE__:${s.title}:${s.category}:${original.link.url}`;
        }

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
  );

  const stories: DigestStory[] = storiesRaw.filter((s): s is DigestStory => s !== null);

  if (stories.length === 0) {
    throw new Error("AI returned 0 valid stories — check the OpenRouter response format");
  }

  // ── Step 7a: Enforce mandatory 3-source minimum ────────────────────────
  // The AI only assigns additionalIdxs when it recognises multiple articles
  // covering the same event. Most stories get sources=1. This step finds
  // best-matching articles from the full pool to pad every story to 3 sources.
  const sourcesBefore = stories.filter(s => (s.sources?.length ?? 0) >= 4).length;
  enrichStorySources(stories, allProcessed);
  const sourcesAfter = stories.filter(s => (s.sources?.length ?? 0) >= 4).length;
  console.log(`📚 Sources: ${sourcesBefore} stories had 4+ before enrichment → ${sourcesAfter}/20 after`);

  // ── Step 7b: Generate images for stories with missing/invalid OG images ──
  // Run in parallel (max 4 at once) — non-blocking on failure
  const needsGeneration = stories.filter(s => s.imageUrl.startsWith("__GENERATE__:"));
  console.log(`🖼️  ${stories.length - needsGeneration.length} valid OG images, ${needsGeneration.length} need generation`);

  if (needsGeneration.length > 0) {
    console.log(`🖼️  Attempting Unsplash search for ${needsGeneration.length} stories without OG images…`);

    // v2.1.0: Three-tier image fallback before SVG
    // Tier 1+2 already ran (Jina OG + direct HTML fetch) during extraction.
    // Tier 3: Unsplash keyword search — real editorial photos when OG fails.
    // Tier 4: Category SVG — guaranteed fallback, always visually correct.
    for (const story of needsGeneration) {
      // Format: __GENERATE__:{title}:{category}:{sourceUrl}
      const raw = story.imageUrl.replace("__GENERATE__:", "");
      // sourceUrl is the last colon-delimited segment starting with http
      const httpIdx = raw.indexOf(":http");
      const sourceUrl = httpIdx >= 0 ? raw.slice(httpIdx + 1) : "";
      const withoutSource = httpIdx >= 0 ? raw.slice(0, httpIdx) : raw;
      const lastColon = withoutSource.lastIndexOf(":");
      const category = withoutSource.slice(lastColon + 1);
      const title = withoutSource.slice(0, lastColon);
      const summary = story.summary?.slice(0, 200) || "";

      const sourceTitleHint = story.sourceTitle && story.sourceTitle !== title
        ? story.sourceTitle
        : "";

      // Tier 2.5: Re-fetch OG from original source URL (breaking news!)
      // Tier 3: AI 5-query → Wikimedia (vision score ≥ 7)
      // Tier 4: Unsplash (optional)
      // Tier 5: null → category SVG
      const editorialUrl = await fetchEditorialImage(title, category, summary, apiKey, sourceTitleHint, sourceUrl || story.sourceUrl);
      if (editorialUrl) {
        story.imageUrl = editorialUrl;
        console.log(`  ✅ Image: "${title.slice(0, 40)}…"`);
      } else {
        story.imageUrl = generateCategoryImage(title, category);
        console.log(`  🎨 SVG fallback: "${title.slice(0, 40)}…"`);
      }
    }
  }

  // ── Step 8: Persist digest ───────────────────────────────────────────────

  // ── Persist digest (upsert for drafts, block for published) ───────────────
  //
  // BEHAVIOUR:
  //   - PUBLISHED exists  → blocked above (409). Unpublish first.
  //   - DRAFT exists      → overwrite with new content (safe to regenerate)
  //   - Nothing exists    → create new row
  //
  // WHY NOT "always create new":
  //   UNIQUE(date, edition) prevents multiple rows for the same day+edition.
  //   The user's intent ("don't replace") applies to PUBLISHED digests only.
  //   Drafts are work-in-progress — overwriting is the correct behaviour.
  //   Published digests are never touched — they accumulate in history.
  const digestData = {
    date: today,
    status: "draft" as const,
    storiesJson: JSON.stringify(stories),
    closingQuote: aiResult.closingQuote || "",
    closingQuoteAuthor: aiResult.closingQuoteAuthor || "",
    generatedAt: new Date().toISOString(),
    publishedAt: null,
    edition: editionId,
  };

  // Upsert: update draft if exists, create if not
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

  console.log(`✅ Digest #${digest!.id} generated: ${stories.length} stories [«${editionId}»]`);
  return { digestId: digest!.id, storiesCount: stories.length, edition: editionId };
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
  "summary": "<EXACTLY 2 paragraphs separated by \\n\\n. P1: what happened (50-70 words). P2: why it matters (50-70 words).>",
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
    // Use OG image if valid, otherwise generate category SVG
    imageUrl: (candidate.ogImage && isValidOgImage(candidate.ogImage))
      ? candidate.ogImage
      : generateCategoryImage(aiResult.title || candidate.title || "", aiResult.category || "Other"),
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

/**
 * reprocessDigestImages — fix a single story's image.
 *
 * Called by the admin /api/digest/:id/reprocess-images endpoint.
 * Tries the full image pipeline for a single story:
 *   1. Re-fetch OG image from source URL
 *   2. Wikimedia AI multi-query (vision-checked)
 *   3. Category SVG
 *
 * Always returns a valid imageUrl string (never null).
 */
export async function reprocessDigestImages(
  story: DigestStory,
  apiKey: string
): Promise<string> {
  const { title, category, summary, sourceUrl } = story;

  // Check quality of already self-hosted images — delete bad ones and re-run pipeline
  if (story.imageUrl.startsWith("/images/")) {
    const hash = story.imageUrl.replace("/images/", "").replace(".webp", "");
    const quality = getStoredImageQuality(hash);

    if (!quality) {
      // File is missing — fall through to full pipeline
      console.log(`  ⚠️  Stored image missing, re-fetching: "${title.slice(0, 40)}"`);
    } else if (!quality.isVideoStill) {
      // Image passes quality check — keep it
      console.log(`  ⏭️  Already hosted & good quality: "${title.slice(0, 40)}"`);
      return story.imageUrl;
    } else {
      // Image fails quality check — delete it and fall through to full pipeline
      console.log(`  🗑️  Deleting bad cached image (${quality.fileSize}B, ${quality.bpp.toFixed(4)} bpp): "${title.slice(0, 40)}"`);
      deleteStoredImage(hash);
      // Fall through to full pipeline below
    }
  }

  // For SVG placeholders: try to replace with a real or AI-generated image
  if (story.imageUrl.startsWith("data:image/svg")) {
    console.log(`  🔄 SVG placeholder — attempting AI/editorial replacement: "${title.slice(0, 40)}"`);
    // Fall through to fetchEditorialImage below
  }

  // Try to rehost if it's an existing external URL (not picsum, not placeholder)
  const isPicsum = story.imageUrl.includes("picsum.photos");
  if (!isPicsum && story.imageUrl.startsWith("http")) {
    const rehosted = await rehostImage(story.imageUrl);
    if (rehosted) {
      console.log(`  📸 Rehosted existing: "${title.slice(0, 40)}"`);
      return rehosted;
    }
  }

  // For picsum or failed rehost: run the full editorial image pipeline
  const result = await fetchEditorialImage(
    title,
    category || "Other",
    summary?.slice(0, 200) || "",
    apiKey,
    undefined,
    sourceUrl
  );

  if (result) {
    console.log(`  ✅ New image: "${title.slice(0, 40)}"`);
    return result;
  }

  // Final fallback: category SVG
  console.log(`  🎨 SVG fallback: "${title.slice(0, 40)}"`);
  return generateCategoryImage(title, category || "Other");
}
