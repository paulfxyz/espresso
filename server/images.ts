/**
 * @file server/images.ts
 * @author Paul Fleury <hello@paulfleury.com>
 * @version 3.5.1
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
