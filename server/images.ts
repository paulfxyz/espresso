/**
 * @file server/images.ts
 * @author Paul Fleury <hello@paulfleury.com>
 * @version 3.5.9
 *
 * Cup of News — Self-hosted image pipeline
 *
 * Every story image is fetched from its source, converted to WebP,
 * and stored on the Fly.io persistent volume (/data/images/).
 * Images are served at /images/{hash}.webp from the Express server.
 *
 * Why self-host:
 *   - No dependency on external CDNs (picsum, Wikimedia, news outlets)
 *   - Consistent format (WebP, 800×450, ~50-80KB)
 *   - No CORS issues, no hotlinking blocks, no 404s after source removes image
 *   - Fast: Cloudflare caches /images/* at the edge
 *
 * Storage layout:
 *   /data/images/{sha256-of-source-url}.webp
 *
 * The hash is derived from the source URL (not the content) so the same
 * external image always maps to the same file. Re-hosting the same URL
 * is a no-op (file already exists → return cached path immediately).
 */

import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import sharp from "sharp";

// ─── Config ───────────────────────────────────────────────────────────────────

const DATA_DIR = process.env.DB_PATH
  ? path.dirname(process.env.DB_PATH)
  : path.join(process.cwd(), "data");

const IMAGES_DIR = path.join(DATA_DIR, "images");

// Target dimensions for story cards (16:7 aspect ratio, full-bleed)
const TARGET_WIDTH  = 1200;
const TARGET_HEIGHT = 525;   // 1200 / (16/7) ≈ 525

/** Ensure images directory exists on startup */
export function ensureImagesDir(): void {
  if (!fs.existsSync(IMAGES_DIR)) {
    fs.mkdirSync(IMAGES_DIR, { recursive: true });
  }
}

/** URL path for a given hash — served by Express at /images/{hash}.webp */
export function imageUrlPath(hash: string): string {
  return `/images/${hash}.webp`;
}

/** Full filesystem path for a given hash */
export function imageFilePath(hash: string): string {
  return path.join(IMAGES_DIR, `${hash}.webp`);
}

/** Hash a source URL to a stable 16-char hex string */
function hashUrl(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 16);
}

/**
 * rehostImage — fetch an external image, convert to WebP, store on disk.
 *
 * Returns the /images/{hash}.webp URL path on success, null on any failure.
 *
 * Steps:
 *   1. Check cache: if file already exists, return immediately
 *   2. Fetch the image (10s timeout, 15MB max)
 *   3. Convert to WebP at 1200×525, quality 82, with smart crop
 *   4. Write to /data/images/{hash}.webp
 *   5. Return /images/{hash}.webp
 *
 * Smart crop: sharp's 'entropy' strategy crops to maximise information content
 * (Shannon entropy of pixel values) — better for complex real-world news scenes.
 * 'attention' was biasing toward high-contrast edges, sometimes selecting
 * backgrounds over subjects. Entropy preserves the most detail-rich region.
 */
export async function rehostImage(sourceUrl: string): Promise<string | null> {
  if (!sourceUrl || sourceUrl.startsWith("data:") || sourceUrl.startsWith("/")) {
    return null;
  }

  ensureImagesDir();

  const hash = hashUrl(sourceUrl);
  const filePath = imageFilePath(hash);
  const urlPath  = imageUrlPath(hash);

  // Cache hit — file already hosted
  if (fs.existsSync(filePath)) {
    return urlPath;
  }

  try {
    // Fetch with realistic browser headers and a 12s timeout
    const res = await fetch(sourceUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; CupOfNews/3.5; +https://cupof.news)",
        "Accept": "image/webp,image/avif,image/*,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(12_000),
    });

    if (!res.ok) {
      console.warn(`  ⚠️  rehostImage: HTTP ${res.status} for ${sourceUrl.slice(0, 80)}`);
      return null;
    }

    // Bail if response is too large (>20MB = not a normal editorial photo)
    const contentLength = Number(res.headers.get("content-length") || 0);
    if (contentLength > 20_000_000) {
      console.warn(`  ⚠️  rehostImage: too large (${contentLength} bytes) — skipping`);
      return null;
    }

    const arrayBuffer = await res.arrayBuffer();
    const inputBuffer = Buffer.from(arrayBuffer);

    // Gate: reject images that are too small to be editorial photos
    // Video thumbnails from broadcast news, small icons, and placeholder images
    // are typically < 400×300 px. We need at least 600×300 for a usable 1200×525 crop.
    const metadata = await sharp(inputBuffer).metadata();
    const srcW = metadata.width ?? 0;
    const srcH = metadata.height ?? 0;
    if (srcW < 600 || srcH < 300) {
      console.warn(`  ⚠️  rehostImage: too small (${srcW}×${srcH}) — skipping`);
      return null;
    }

    // Reject suspiciously small files for their claimed dimensions
    // A 1200×675 video thumbnail might only be 15-25KB — real photos are 80KB+
    // Formula: reject if bytes-per-pixel < 0.04 (extremely compressed = video still)
    const bytesPP = inputBuffer.length / Math.max(1, srcW * srcH);
    if (bytesPP < 0.04 && inputBuffer.length < 40_000) {
      console.warn(`  ⚠️  rehostImage: likely video frame (${inputBuffer.length} bytes, ${srcW}×${srcH}, ${bytesPP.toFixed(4)} bpp) — skipping`);
      return null;
    }

    // Convert to WebP: resize to 1200×525, smart crop, quality 82
    // sharp 'entropy' strategy: maximises Shannon entropy of the crop region
    // — better for news photos with complex real-world scenes
    const webpBuffer = await sharp(inputBuffer)
      .resize(TARGET_WIDTH, TARGET_HEIGHT, {
        fit: "cover",
        position: "entropy",  // entropy crop — maximise information content
      })
      .webp({ quality: 82 })
      .toBuffer();

    // Post-conversion quality gate: reject video stills after WebP conversion
    // A real editorial photo at 1200×525 quality 82 is typically 40-120KB.
    // Video frames compress to <25KB because they have very little detail.
    const postBpp = webpBuffer.length / (TARGET_WIDTH * TARGET_HEIGHT);
    if (postBpp < 0.04 && webpBuffer.length < 40_960) {
      console.warn(`  ⚠️  rehostImage: post-conversion video still (${webpBuffer.length} bytes, ${postBpp.toFixed(4)} bpp) — rejecting`);
      return null;
    }

    fs.writeFileSync(filePath, webpBuffer);
    console.log(`  📸 Rehosted: ${sourceUrl.slice(0, 60)}… → ${urlPath} (${Math.round(webpBuffer.length / 1024)}KB)`);
    return urlPath;

  } catch (err) {
    console.warn(`  ⚠️  rehostImage failed for ${sourceUrl.slice(0, 80)}: ${err}`);
    return null;
  }
}

/**
 * rehostOrPassthrough — try to rehost, fall back to original URL.
 * Used when we have a good external URL but want to self-host if possible.
 */
export async function rehostOrPassthrough(sourceUrl: string): Promise<string> {
  const hosted = await rehostImage(sourceUrl);
  return hosted ?? sourceUrl;
}

/** List all cached image hashes */
export function listCachedImages(): string[] {
  if (!fs.existsSync(IMAGES_DIR)) return [];
  return fs.readdirSync(IMAGES_DIR)
    .filter(f => f.endsWith(".webp"))
    .map(f => f.replace(".webp", ""));
}

/** Delete a cached image by hash */
export function deleteCachedImage(hash: string): void {
  const p = imageFilePath(hash);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

/**
 * getStoredImageQuality — check quality of an already-stored WebP image.
 * Returns null if the file doesn't exist.
 */
export function getStoredImageQuality(hash: string): {
  filePath: string;
  fileSize: number;
  bpp: number;
  isVideoStill: boolean;
} | null {
  const fp = imageFilePath(hash);
  if (!fs.existsSync(fp)) return null;
  const fileSize = fs.statSync(fp).size;
  const bpp = fileSize / (1200 * 525);
  const isVideoStill = bpp < 0.04 && fileSize < 40_960;
  return { filePath: fp, fileSize, bpp, isVideoStill };
}

/**
 * deleteStoredImage — delete a stored WebP image by hash.
 * Returns true if the file was deleted, false if it didn't exist.
 */
export function deleteStoredImage(hash: string): boolean {
  const fp = imageFilePath(hash);
  if (fs.existsSync(fp)) {
    fs.unlinkSync(fp);
    return true;
  }
  return false;
}

/**
 * generateAiImage — generate a photorealistic news photo via OpenRouter.
 *
 * Uses openai/gpt-5-image-mini with a strict editorial prompt.
 * Returns a hosted /images/{hash}.webp path, or null if generation fails.
 *
 * @param title    Story headline
 * @param category Story category (World, Business, etc.)
 * @param summary  Short summary (first 150 chars)
 * @param openrouterKey OpenRouter API key
 */
export async function generateAiImage(
  title: string,
  category: string,
  summary: string,
  openrouterKey: string
): Promise<string | null> {
  const prompt = `Photorealistic editorial news photograph for a news story.
Story: "${title}". Category: ${category}.
Context: ${summary.slice(0, 150)}

Requirements:
- Real documentary/photojournalism style
- No text, no logos, no watermarks, no overlays
- No cartoon, no illustration, no infographic
- No website screenshots, no app UI
- Neutral, factual visual representation of the story topic
- High resolution, sharp focus
- If the story is about a person, show a relevant setting or scene, not a portrait`;

  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${openrouterKey}`,
        "HTTP-Referer": "https://cupof.news",
        "X-Title": "Cup of News",
      },
      body: JSON.stringify({
        model: "openai/gpt-5-image-mini",
        messages: [{ role: "user", content: prompt }],
        modalities: ["image", "text"],    // required for image generation
        max_tokens: 4000,
      }),
      signal: AbortSignal.timeout(120_000),  // 120s — image generation can be slow
    });

    if (!res.ok) {
      const errText = await res.text();
      console.warn(`  ⚠️  generateAiImage: API error ${res.status} — ${errText.slice(0, 200)}`);
      return null;
    }

    const data = await res.json() as {
      choices: Array<{
        message: {
          role: string;
          content: string | Array<{ type: string; image_url?: { url: string }; text?: string }> | null;
          images?: Array<{ type: string; image_url: { url: string } }>;
        }
      }>;
    };
    const message = data.choices?.[0]?.message as any;
    if (!message) {
      console.warn("  ⚠️  generateAiImage: no message in response");
      return null;
    }

    // OpenRouter image generation: image is in message.images[].image_url.url
    let dataUrl: string | null = null;

    // Primary: check message.images (OpenRouter image generation format)
    if (message.images && Array.isArray(message.images) && message.images.length > 0) {
      const imageUrl = message.images[0]?.image_url?.url;
      if (imageUrl && imageUrl.startsWith("data:")) {
        dataUrl = imageUrl;
      }
    }

    // Fallback: check message.content (sometimes the data URL is embedded in content text)
    if (!dataUrl) {
      const content = message.content;
      if (typeof content === "string") {
        const match = content.match(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/);
        if (match) dataUrl = match[0];
      } else if (Array.isArray(content)) {
        for (const part of content) {
          if (part.type === "image_url" && part.image_url?.url?.startsWith("data:")) {
            dataUrl = part.image_url.url;
            break;
          }
        }
      }
    }

    if (!dataUrl) {
      // Log the full response structure for debugging
      console.warn("  ⚠️  generateAiImage: no image data found. Message keys:", Object.keys(message));
      return null;
    }

    // Convert base64 data URL → Buffer
    const base64Data = dataUrl.replace(/^data:image\/[^;]+;base64,/, "");
    const imageBuffer = Buffer.from(base64Data, "base64");

    // Convert to WebP: resize to 1200×525, entropy crop, quality 82
    const webpBuffer = await sharp(imageBuffer)
      .resize(TARGET_WIDTH, TARGET_HEIGHT, {
        fit: "cover",
        position: "entropy",
      })
      .webp({ quality: 82 })
      .toBuffer();

    // Quality gate: same bpp check as rehostImage
    const postBpp = webpBuffer.length / (TARGET_WIDTH * TARGET_HEIGHT);
    if (postBpp < 0.04 && webpBuffer.length < 40_960) {
      console.warn(`  ⚠️  generateAiImage: low quality output (${webpBuffer.length} bytes, ${postBpp.toFixed(4)} bpp) — rejecting`);
      return null;
    }

    // Hash based on the prompt (not a URL) — stable for same inputs
    const hash = createHash("md5").update(prompt).digest("hex").slice(0, 16);

    ensureImagesDir();
    const filePath = imageFilePath(hash);
    const urlPath = imageUrlPath(hash);

    fs.writeFileSync(filePath, webpBuffer);
    console.log(`  🎨 AI image generated: ${urlPath} (${Math.round(webpBuffer.length / 1024)}KB)`);
    return urlPath;

  } catch (err) {
    console.warn(`  ⚠️  generateAiImage failed: ${err}`);
    return null;
  }
}
