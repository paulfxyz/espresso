/**
 * Espresso — Morning Digest Pipeline
 *
 * Flow:
 *  1. Fetch all unprocessed links
 *  2. Extract content via Jina Reader (r.jina.ai) — free, no API key
 *  3. Extract OG image from the original URL
 *  4. Send everything to OpenRouter: rank top 10, summarize, quote
 *  5. Assemble digest JSON and persist to DB
 */

import { storage } from "./storage";
import type { DigestStory, Link } from "@shared/schema";
import { createHash, randomUUID } from "crypto";
import { fetchTrendingStories } from "./trends";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const JINA_PREFIX = "https://r.jina.ai/";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getTodayDate(): string {
  return new Date().toISOString().split("T")[0];
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function detectSourceType(url: string): string {
  if (/youtube\.com|youtu\.be/.test(url)) return "youtube";
  if (/tiktok\.com/.test(url)) return "tiktok";
  if (/twitter\.com|x\.com/.test(url)) return "tweet";
  return "article";
}

// Extract OG image from raw HTML (lightweight, no cheerio needed for this)
function extractOgImage(html: string, baseUrl: string): string | null {
  const match = html.match(/<meta[^>]+(?:property="og:image"|name="og:image")[^>]+content="([^"]+)"/i)
    || html.match(/<meta[^>]+content="([^"]+)"[^>]+(?:property="og:image"|name="og:image")/i);
  if (match) {
    let img = match[1];
    if (img.startsWith("//")) img = "https:" + img;
    if (img.startsWith("/")) {
      try { img = new URL(img, baseUrl).href; } catch {}
    }
    return img;
  }
  return null;
}

async function fetchRaw(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Espresso-Bot/1.0" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

async function extractViaJina(url: string): Promise<{ text: string; title: string }> {
  const jinaUrl = `${JINA_PREFIX}${url}`;
  const res = await fetch(jinaUrl, {
    headers: {
      "Accept": "text/markdown",
      "User-Agent": "Espresso-Bot/1.0",
      "X-Return-Format": "markdown",
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Jina failed for ${url}: HTTP ${res.status}`);
  const text = await res.text();
  // Jina returns "Title: ..." as first line
  const titleMatch = text.match(/^Title:\s*(.+)/m);
  const title = titleMatch ? titleMatch[1].trim() : url;
  return { text: text.slice(0, 8000), title };
}

// ─── OpenRouter call ──────────────────────────────────────────────────────────

async function callOpenRouter(messages: any[], apiKey: string): Promise<string> {
  const res = await fetch(OPENROUTER_API_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://github.com/paulfxyz/espresso",
      "X-Title": "Espresso Morning Digest",
    },
    body: JSON.stringify({
      model: "google/gemini-flash-1.5",
      messages,
      response_format: { type: "json_object" },
      temperature: 0.4,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenRouter error: ${res.status} — ${err}`);
  }
  const data = await res.json();
  return data.choices[0].message.content;
}

// ─── Main pipeline ────────────────────────────────────────────────────────────

export async function runDailyPipeline(apiKey: string): Promise<{ digestId: number; storiesCount: number }> {
  const today = getTodayDate();

  // Check if digest already exists for today
  const existing = storage.getDigestByDate(today);
  if (existing && existing.status === "published") {
    throw new Error(`Published digest already exists for ${today}`);
  }

  // 1. Collect all unprocessed links + links from last 3 days (fresh pool)
  const allLinks = storage.getUnprocessedLinks();
  // ─── Trend fallback ────────────────────────────────────────────────────────
  // If user has submitted fewer than 10 links, supplement with trending
  // stories from trusted RSS sources (Reuters, BBC, Economist, FT, NYT, WSJ).
  // User-submitted links always have priority — trends only fill the gap.
  const MIN_LINKS_BEFORE_TRENDS = 10;
  let trendItems: Array<{ url: string; title: string; source: string; text: string; ogImage: string | null }> = [];

  if (allLinks.length < MIN_LINKS_BEFORE_TRENDS) {
    const needed = MIN_LINKS_BEFORE_TRENDS - allLinks.length;
    console.log(`📰 Only ${allLinks.length} user link(s) — fetching ${needed}+ trending stories to fill gaps…`);
    try {
      const trends = await fetchTrendingStories(needed);
      for (const t of trends) {
        try {
          const extracted = await extractViaJina(t.url);
          trendItems.push({
            url: t.url,
            title: extracted.title || t.title,
            source: t.source,
            text: extracted.text.slice(0, 2000),
            ogImage: null,
          });
        } catch {
          // If Jina fails for a trend, use title as stub
          trendItems.push({ url: t.url, title: t.title, source: t.source, text: t.title, ogImage: null });
        }
      }
    } catch (e) {
      console.warn("⚠️  Trend fetch failed:", e);
    }
  }

  // If STILL no content at all, bail
  if (allLinks.length === 0 && trendItems.length === 0) {
    throw new Error("No links available and no trending stories could be fetched. Try again later.");
  }

  // 2. Extract content for each link (parallel, max 8 at a time)
  const processed: Array<{ link: Link; text: string; title: string; ogImage: string | null }> = [];

  const chunks: Link[][] = [];
  for (let i = 0; i < allLinks.length; i += 8) chunks.push(allLinks.slice(i, i + 8));

  for (const chunk of chunks) {
    const results = await Promise.allSettled(
      chunk.map(async (link) => {
        let text = link.extractedText;
        let title = link.title || link.url;
        let ogImage = link.ogImage;

        if (!text) {
          try {
            const extracted = await extractViaJina(link.url);
            text = extracted.text;
            title = extracted.title || title;

            // Also try to get OG image from raw HTML
            if (!ogImage) {
              try {
                const rawHtml = await fetchRaw(link.url);
                ogImage = extractOgImage(rawHtml, link.url);
              } catch {}
            }

            // Cache extracted content in DB
            const hash = sha256(text);
            storage.updateLink(link.id, {
              extractedText: text,
              title,
              ogImage: ogImage || undefined,
              contentHash: hash,
              sourceType: detectSourceType(link.url),
            });
          } catch (e) {
            console.warn(`⚠️  Could not extract ${link.url}:`, e);
            text = link.title || link.url;
          }
        }

        return { link, text: text || "", title, ogImage: ogImage || null };
      })
    );

    for (const r of results) {
      if (r.status === "fulfilled") processed.push(r.value);
    }
  }

  if (processed.length === 0) throw new Error("No content could be extracted from submitted links.");

  // 3. Load previously used story hashes to avoid 72h dedup
  const recentDigests = storage.getAllDigests()
    .filter(d => {
      const dDate = new Date(d.date);
      const threeDaysAgo = new Date();
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
      return dDate > threeDaysAgo;
    });

  const recentStoryUrls = new Set<string>();
  for (const d of recentDigests) {
    try {
      const stories: DigestStory[] = JSON.parse(d.storiesJson);
      stories.forEach(s => recentStoryUrls.add(s.sourceUrl));
    } catch {}
  }

  // ─── Merge user links + trend items ─────────────────────────────────────
  // User links come first (priority), trend items fill the rest
  const trendProcessed = trendItems.map(t => ({
    link: {
      id: 0,
      url: t.url,
      title: t.title,
      sourceType: "trend",
      extractedText: t.text,
      processedAt: null,
      digestId: null,
      ogImage: t.ogImage,
      notes: `Auto-fetched from ${t.source}`,
      submittedAt: new Date().toISOString(),
      contentHash: null,
    } as Link,
    text: t.text,
    title: t.title,
    ogImage: t.ogImage,
  }));

  const allProcessed = [...processed, ...trendProcessed];

  // Build content payload for AI
  const contentItems = allProcessed.map((p, idx) => ({
    idx: idx + 1,
    url: p.link.url,
    title: p.title,
    sourceType: p.link.sourceType || "article",
    recentlyUsed: recentStoryUrls.has(p.link.url),
    textPreview: p.text.slice(0, 2000),
    isTrend: (p.link as any).sourceType === "trend",
    trendSource: (p.link as any).notes || undefined,
  }));

  // 4. Ask OpenRouter to rank + summarize top 10
  const systemPrompt = `You are an expert editorial AI for "Espresso" — a curated morning news digest inspired by The Economist Espresso.
Your task: from a list of articles/content, select the 10 most important, distinct, and newsworthy stories from the PAST FEW DAYS.

Rules:
- Prefer fresh content (not older than 3 days)
- Strongly prefer user-submitted content (isTrend=false) over auto-fetched trend stories
- Only use trend stories (isTrend=true) to fill slots when user content is insufficient or less newsworthy
- Avoid stories marked as recentlyUsed=true unless critically important
- No duplicate stories (same underlying news from different sources = pick the best one)
- Each summary: maximum 200 words, written in a clear, intelligent, slightly opinionated editorial voice
- Identify the most important category for each: Technology, Science, Business, Politics, World, Culture, Health, Environment, Sports, Other
- Return valid JSON only, no markdown, no code fences`;

  const userPrompt = `Here are ${contentItems.length} articles to process. Select the 10 best, summarize each, and generate an inspiring closing quote.

ARTICLES:
${JSON.stringify(contentItems, null, 2)}

Return this exact JSON structure:
{
  "stories": [
    {
      "idx": <original idx from above>,
      "title": "<compelling headline, max 80 chars>",
      "summary": "<editorial summary, max 200 words>",
      "category": "<one of: Technology|Science|Business|Politics|World|Culture|Health|Environment|Sports|Other>"
    }
  ],
  "closingQuote": "<an inspiring, thought-provoking quote relevant to today's themes>",
  "closingQuoteAuthor": "<Author Name, Context>"
}`;

  const rawJson = await callOpenRouter([
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ], apiKey);

  let aiResult: any;
  try {
    aiResult = JSON.parse(rawJson);
  } catch {
    throw new Error("OpenRouter returned invalid JSON: " + rawJson.slice(0, 200));
  }

  if (!aiResult.stories || !Array.isArray(aiResult.stories)) {
    throw new Error("Unexpected AI response structure");
  }

  // 5. Assemble digest stories
  const stories: DigestStory[] = aiResult.stories.slice(0, 10).map((s: any) => {
    const original = allProcessed[s.idx - 1];
    return {
      id: randomUUID(),
      title: s.title || original?.title || "Untitled",
      summary: s.summary || "",
      imageUrl: original?.ogImage || `https://source.unsplash.com/800x450/?${encodeURIComponent(s.category || "news")}`,
      sourceUrl: original?.link.url || "",
      sourceTitle: original?.title || original?.link.url || "",
      category: s.category || "Other",
      linkId: original?.link.id || 0,
    };
  });

  // 6. Persist digest
  const digestData = {
    date: today,
    status: "draft" as const,
    storiesJson: JSON.stringify(stories),
    closingQuote: aiResult.closingQuote || "",
    closingQuoteAuthor: aiResult.closingQuoteAuthor || "",
    generatedAt: new Date().toISOString(),
    publishedAt: null,
  };

  let digest;
  if (existing) {
    digest = storage.updateDigest(existing.id, digestData);
  } else {
    digest = storage.createDigest(digestData);
  }

  // 7. Mark links as processed
  for (const story of stories) {
    if (story.linkId) {
      storage.updateLink(story.linkId, {
        processedAt: new Date().toISOString(),
        digestId: digest!.id,
      });
    }
  }

  return { digestId: digest!.id, storiesCount: stories.length };
}

// Swap one story for another from the available pool
export async function swapStory(
  digestId: number,
  storyId: string,
  apiKey: string
): Promise<DigestStory> {
  const digest = storage.getDigest(digestId);
  if (!digest) throw new Error("Digest not found");

  const stories: DigestStory[] = JSON.parse(digest.storiesJson);
  const storyIdx = stories.findIndex(s => s.id === storyId);
  if (storyIdx === -1) throw new Error("Story not found in digest");

  // Find unused links
  const usedLinkIds = new Set(stories.map(s => s.linkId));
  const unusedLinks = storage.getAllLinks().filter(l => !usedLinkIds.has(l.id) && l.extractedText);

  if (unusedLinks.length === 0) throw new Error("No more unused links available to swap");

  // Pick the one not already in digest
  const candidate = unusedLinks[0];

  const systemPrompt = `You are an editorial AI for "Espresso" morning digest. Summarize the following article in a compelling way.`;
  const userPrompt = `Article title: ${candidate.title}
URL: ${candidate.url}
Content: ${(candidate.extractedText || "").slice(0, 3000)}

Return JSON:
{
  "title": "<compelling headline max 80 chars>",
  "summary": "<editorial summary max 200 words>",
  "category": "<Technology|Science|Business|Politics|World|Culture|Health|Environment|Sports|Other>"
}`;

  const rawJson = await callOpenRouter([
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ], apiKey);

  const aiResult = JSON.parse(rawJson);

  const newStory: DigestStory = {
    id: randomUUID(),
    title: aiResult.title || candidate.title || "Untitled",
    summary: aiResult.summary || "",
    imageUrl: candidate.ogImage || `https://source.unsplash.com/800x450/?${encodeURIComponent(aiResult.category || "news")}`,
    sourceUrl: candidate.url,
    sourceTitle: candidate.title || candidate.url,
    category: aiResult.category || "Other",
    linkId: candidate.id,
  };

  // Replace in stories array
  stories[storyIdx] = newStory;
  storage.updateDigest(digestId, { storiesJson: JSON.stringify(stories) });

  // Mark old link as unprocessed, new link as processed
  const oldStory = stories[storyIdx];
  storage.updateLink(candidate.id, {
    processedAt: new Date().toISOString(),
    digestId,
  });

  return newStory;
}
