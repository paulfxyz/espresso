/**
 * @file server/trends.ts
 * @author Paul Fleury <hello@paulfleury.com>
 * @version 0.2.0
 *
 * Espresso — RSS Trend Fallback Engine
 *
 * Context:
 *   When the user hasn't submitted enough links (< MIN_LINKS_BEFORE_TRENDS),
 *   this module supplements the daily digest with fresh stories pulled from
 *   7 trusted public RSS feeds. No API keys required.
 *
 * Priority contract:
 *   User-submitted links ALWAYS outrank trend items. The AI prompt is explicitly
 *   instructed to prefer isTrend=false content. Trends are filler, not feature.
 *
 * Freshness rule:
 *   Only stories published within the last MAX_AGE_HOURS (72h) are eligible.
 *   This prevents stale weekend stories from appearing Monday morning.
 *
 * Deduplication:
 *   Two-pass dedup: exact URL match first, then title-prefix similarity (first
 *   60 chars normalized). This catches wire stories (AP/Reuters) that appear
 *   on multiple outlets under slightly different URLs.
 *
 * Known limitation (v0.2.0):
 *   FT and Economist use Atom-style <link href="..."/> — handled via fallback
 *   attribute extractor. Some feeds (FT) require a subscription to read full
 *   content; Jina Reader may return limited text for those.
 *
 * Sources (all public, no auth):
 *   Reuters · BBC World · The Economist · Financial Times
 *   NYT World · WSJ World · Associated Press
 */

// ─── RSS Source Registry ──────────────────────────────────────────────────────

interface RSSSource {
  name: string;
  url: string;
  domain: string;
  /** Some feeds use Atom <link href="..."/> instead of <link>url</link> */
  atomStyle?: boolean;
}

const TRUSTED_RSS_SOURCES: RSSSource[] = [
  {
    name: "Reuters",
    url: "https://feeds.reuters.com/reuters/topNews",
    domain: "reuters.com",
  },
  {
    name: "BBC News",
    url: "https://feeds.bbci.co.uk/news/world/rss.xml",
    domain: "bbc.com",
  },
  {
    name: "The Economist",
    url: "https://www.economist.com/the-world-this-week/rss.xml",
    domain: "economist.com",
    atomStyle: true,
  },
  {
    name: "Financial Times",
    url: "https://www.ft.com/rss/home/uk",
    domain: "ft.com",
    atomStyle: true,
  },
  {
    name: "NYT World",
    url: "https://rss.nytimes.com/services/xml/rss/nyt/World.xml",
    domain: "nytimes.com",
  },
  {
    name: "WSJ World",
    url: "https://feeds.a.dj.com/rss/RSSWorldNews.xml",
    domain: "wsj.com",
  },
  {
    name: "Associated Press",
    url: "https://rsshub.app/apnews/topics/apf-topnews",
    domain: "apnews.com",
  },
];

/** Stories older than this are discarded before sending to AI */
const MAX_AGE_HOURS = 72;

/** Hard cap on feed XML to parse — guards against ReDoS on malformed/huge feeds */
const MAX_FEED_BYTES = 100_000;

/** Max items to take from each source before dedup */
const MAX_ITEMS_PER_SOURCE = 6;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TrendStory {
  url: string;
  title: string;
  publishedAt: string;
  source: string;
  sourceDomain: string;
}

// ─── XML Parsing Helpers ──────────────────────────────────────────────────────

/**
 * Extract text content from an XML tag, handling both CDATA and plain text.
 * Capped at 500 chars to avoid feeding huge description blobs downstream.
 *
 * Audit note (v0.2.0): added .slice(0, 500) guard — the previous version had
 * no cap and could produce extremely large strings from description tags.
 */
function extractTag(xml: string, tag: string): string | null {
  const patterns = [
    new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`, "i"),
    new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, "i"), // non-greedy text-node only
  ];
  for (const re of patterns) {
    const m = xml.match(re);
    if (m) return m[1].trim().slice(0, 500);
  }
  return null;
}

/**
 * Fallback for Atom-style <link rel="alternate" href="..."/> tags.
 * FT and The Economist use this format instead of <link>url</link>.
 *
 * Added in v0.2.0 — previously FT and Economist links were returning empty
 * because we only matched the text-node form.
 */
function extractAtomLink(itemXml: string): string | null {
  // <link rel="alternate" href="https://..."/>  or  <link href="https://..."/>
  const m = itemXml.match(/<link[^>]+href="(https?:[^"]+)"/i);
  return m ? m[1] : null;
}

/**
 * Parse all <item> blocks from RSS/Atom XML.
 * Applies MAX_FEED_BYTES guard before any regex work.
 */
function extractItems(
  feedXml: string,
  atomStyle = false
): Array<{ title: string; link: string; pubDate: string }> {
  // Guard: slice large feeds before regex processing
  const safe = feedXml.slice(0, MAX_FEED_BYTES);

  const items: Array<{ title: string; link: string; pubDate: string }> = [];
  const itemMatches = safe.matchAll(/<item[^>]*>([\s\S]*?)<\/item>/gi);

  for (const match of itemMatches) {
    const itemXml = match[1];
    const title = extractTag(itemXml, "title") || "";

    // Link extraction: try text-node, then Atom href, then guid
    let link =
      extractTag(itemXml, "link") ||
      (atomStyle ? extractAtomLink(itemXml) : null) ||
      extractTag(itemXml, "guid") ||
      "";

    // Strip whitespace and newlines that RSS generators sometimes inject
    link = link.replace(/\s/g, "");

    const pubDate =
      extractTag(itemXml, "pubDate") ||
      extractTag(itemXml, "dc:date") ||
      extractTag(itemXml, "published") ||
      "";

    if (title && link && link.startsWith("http")) {
      items.push({ title, link, pubDate });
    }
  }

  return items;
}

/** Parse an RSS date string into a Date. Returns null on failure. */
function parseRSSDate(dateStr: string): Date | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d;
}

// ─── Deduplication ────────────────────────────────────────────────────────────

/**
 * Normalize a title for similarity comparison.
 * Lowercase, strip punctuation, collapse whitespace, take first 60 chars.
 *
 * This catches wire stories that appear on multiple outlets under the same
 * headline but different URLs — a common pattern with Reuters/AP wire content.
 */
function normTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

// ─── Feed Fetcher ─────────────────────────────────────────────────────────────

async function fetchFeed(source: RSSSource): Promise<TrendStory[]> {
  try {
    const res = await fetch(source.url, {
      headers: {
        "User-Agent": "Espresso-Bot/0.2 (RSS; https://github.com/paulfxyz/espresso)",
        "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
      },
      signal: AbortSignal.timeout(12000),
    });

    if (!res.ok) {
      console.warn(`⚠️  RSS ${source.name}: HTTP ${res.status}`);
      return [];
    }

    const xml = await res.text();
    const items = extractItems(xml, source.atomStyle);
    const cutoff = new Date(Date.now() - MAX_AGE_HOURS * 60 * 60 * 1000);

    return items
      .filter((item) => {
        // If no date available, include it (better to over-include than miss)
        if (!item.pubDate) return true;
        const d = parseRSSDate(item.pubDate);
        return d ? d > cutoff : true;
      })
      .slice(0, MAX_ITEMS_PER_SOURCE)
      .map((item) => ({
        url: item.link,
        title: item.title,
        publishedAt: item.pubDate || new Date().toISOString(),
        source: source.name,
        sourceDomain: source.domain,
      }));
  } catch (e) {
    console.warn(`⚠️  RSS fetch failed [${source.name}]:`, (e as Error).message);
    return [];
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetch trending stories from all configured RSS sources in parallel.
 *
 * Returns deduplicated TrendStory[] sorted by source (preserves editorial
 * diversity — we don't want 5 Reuters stories and nothing else).
 *
 * Dedup strategy (v0.2.0 improvement):
 *   1. Exact URL match
 *   2. Normalized title prefix match (catches wire story duplicates)
 *
 * @param needed - Minimum number of stories to return. We fetch 3× and let
 *                 the AI pipeline rank and pick, so always return a generous pool.
 */
export async function fetchTrendingStories(needed = 20): Promise<TrendStory[]> {
  if (needed <= 0) return [];

  console.log(`📡 Fetching trends from ${TRUSTED_RSS_SOURCES.length} RSS sources in parallel…`);

  const results = await Promise.allSettled(
    TRUSTED_RSS_SOURCES.map((s) => fetchFeed(s))
  );

  // Interleave results round-robin (1 from each source) to maximize diversity
  // before truncation — prevents one prolific source from dominating the pool
  const buckets: TrendStory[][] = results
    .filter((r): r is PromiseFulfilledResult<TrendStory[]> => r.status === "fulfilled")
    .map((r) => r.value)
    .filter((arr) => arr.length > 0);

  const interleaved: TrendStory[] = [];
  const maxLen = Math.max(...buckets.map((b) => b.length), 0);
  for (let i = 0; i < maxLen; i++) {
    for (const bucket of buckets) {
      if (bucket[i]) interleaved.push(bucket[i]);
    }
  }

  // Two-pass dedup
  const seenUrls = new Set<string>();
  const seenTitles = new Set<string>();
  const deduped = interleaved.filter((s) => {
    if (seenUrls.has(s.url)) return false;
    const nt = normTitle(s.title);
    if (seenTitles.has(nt)) return false;
    seenUrls.add(s.url);
    seenTitles.add(nt);
    return true;
  });

  console.log(
    `📡 Trend pool: ${deduped.length} stories from ${buckets.length}/${TRUSTED_RSS_SOURCES.length} sources`
  );

  // Return 3× needed so AI has enough to select from
  return deduped.slice(0, Math.max(needed * 3, 30));
}
