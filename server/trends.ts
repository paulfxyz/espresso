/**
 * Espresso — Trending News Fallback
 *
 * When the user hasn't submitted enough links, we supplement with trending
 * stories from trusted RSS sources: Reuters, The Economist, FT, NYT, WSJ, BBC.
 *
 * Rules:
 * - User-submitted links ALWAYS take priority. Trends only fill gaps.
 * - Only RSS feeds (no scrapers, no API keys required).
 * - Only stories from the past 72 hours are eligible.
 * - Marked as sourceType="trend" so the admin UI can distinguish them.
 */

const TRUSTED_RSS_SOURCES = [
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
  },
  {
    name: "Financial Times",
    url: "https://www.ft.com/rss/home/uk",
    domain: "ft.com",
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

// Max age for trend stories (72 hours)
const MAX_AGE_HOURS = 72;

interface TrendStory {
  url: string;
  title: string;
  publishedAt: string;
  source: string;
  sourceDomain: string;
}

function parseRSSDate(dateStr: string): Date | null {
  try {
    return new Date(dateStr);
  } catch {
    return null;
  }
}

function extractTag(xml: string, tag: string): string | null {
  // Try with namespace prefix first, then without
  const patterns = [
    new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`, "i"),
    new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"),
  ];
  for (const re of patterns) {
    const m = xml.match(re);
    if (m) return m[1].trim();
  }
  return null;
}

function extractItems(feedXml: string): Array<{ title: string; link: string; pubDate: string }> {
  const items: Array<{ title: string; link: string; pubDate: string }> = [];
  const itemMatches = feedXml.matchAll(/<item[^>]*>([\s\S]*?)<\/item>/gi);

  for (const match of itemMatches) {
    const itemXml = match[1];
    const title = extractTag(itemXml, "title") || "";
    const link = extractTag(itemXml, "link") || extractTag(itemXml, "guid") || "";
    const pubDate = extractTag(itemXml, "pubDate") || extractTag(itemXml, "dc:date") || "";

    if (title && link && link.startsWith("http")) {
      items.push({ title, link, pubDate });
    }
  }

  return items;
}

async function fetchFeed(source: { name: string; url: string; domain: string }): Promise<TrendStory[]> {
  try {
    const res = await fetch(source.url, {
      headers: {
        "User-Agent": "Espresso-Bot/1.0 (RSS Reader; https://github.com/paulfxyz/espresso)",
        "Accept": "application/rss+xml, application/xml, text/xml, */*",
      },
      signal: AbortSignal.timeout(12000),
    });

    if (!res.ok) return [];

    const xml = await res.text();
    const items = extractItems(xml);
    const cutoff = new Date(Date.now() - MAX_AGE_HOURS * 60 * 60 * 1000);

    return items
      .filter(item => {
        if (!item.pubDate) return true; // include if no date (better safe)
        const d = parseRSSDate(item.pubDate);
        return d ? d > cutoff : true;
      })
      .slice(0, 5) // max 5 per source
      .map(item => ({
        url: item.link,
        title: item.title,
        publishedAt: item.pubDate || new Date().toISOString(),
        source: source.name,
        sourceDomain: source.domain,
      }));
  } catch (e) {
    console.warn(`⚠️  RSS fetch failed for ${source.name}:`, (e as Error).message);
    return [];
  }
}

/**
 * Fetch trending stories from all RSS sources.
 * Returns an array of TrendStory objects, deduplicated by URL.
 *
 * @param needed - how many trend stories we want (we fetch more and let AI pick)
 */
export async function fetchTrendingStories(needed: number = 20): Promise<TrendStory[]> {
  if (needed <= 0) return [];

  console.log(`📡 Fetching trending stories from ${TRUSTED_RSS_SOURCES.length} RSS sources…`);

  // Fetch all sources in parallel
  const results = await Promise.allSettled(
    TRUSTED_RSS_SOURCES.map(s => fetchFeed(s))
  );

  const all: TrendStory[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") all.push(...r.value);
  }

  // Deduplicate by URL
  const seen = new Set<string>();
  const deduped = all.filter(s => {
    if (seen.has(s.url)) return false;
    seen.add(s.url);
    return true;
  });

  console.log(`📡 Found ${deduped.length} fresh trending stories from RSS sources`);
  return deduped.slice(0, needed * 3); // return 3x needed so AI has room to pick
}
