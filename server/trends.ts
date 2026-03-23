/**
 * @file server/trends.ts
 * @author Paul Fleury <hello@paulfleury.com>
 * @version 0.4.0
 *
 * Cup of News — RSS Trend Fallback Engine
 *
 * WHY THIS EXISTS:
 *   Cup of News is most useful when you feed it your own links. But a great morning
 *   briefing shouldn't fail just because you didn't bookmark anything this week.
 *   This module provides a safety net: 25 trusted RSS sources that ensure every
 *   morning edition has at least 10 stories worth reading, even on lazy weeks.
 *
 * DESIGN DECISIONS:
 *   - No API keys required. Pure public RSS/Atom feeds only. Zero cost.
 *   - 25 sources chosen for geographic + topical diversity:
 *     wire services, broadsheets, tech press, science, culture.
 *   - Stories older than 72 hours are discarded (prevents stale weekend
 *     content appearing Monday morning — a real annoyance in v0.1.0).
 *   - Round-robin interleaving ensures no single source dominates the pool.
 *   - Two-pass dedup: URL exact match + normalized title prefix (catches
 *     wire story duplicates — Reuters + AP often run identical stories).
 *   - MAX_FEED_BYTES = 100KB guards against ReDoS on malformed XML.
 *
 * SOURCES GROUPED BY CATEGORY:
 *   Wire services     — Reuters, AP, AFP
 *   English broadsheets — BBC, Guardian, NYT, WSJ, FT, Telegraph, Independent
 *   The Economist     — flagship + tech/finance sections
 *   European press    — Le Monde (EN), Der Spiegel, El País (EN), Euronews
 *   Tech press        — Ars Technica, Wired, MIT Tech Review, The Verge
 *   Science           — Nature, Scientific American, New Scientist
 *   Business/finance  — Bloomberg, FT Markets
 *   Emerging markets  — Al Jazeera, South China Morning Post
 *
 * KNOWN LIMITATIONS:
 *   - FT and Economist require subscriptions for full articles. Jina Reader
 *     extracts what it can; summaries may be thinner for paywalled content.
 *   - AFP doesn't offer a public global RSS; using their English world feed
 *     via a reliable aggregator.
 *   - Some feeds (Le Monde EN, SCMP) occasionally go stale or change URLs.
 *     Sources are validated on each run — failures are silent and non-blocking.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

interface RSSSource {
  name: string;
  url: string;
  domain: string;
  category: string;
  /** Some feeds use Atom <link href="..."/> instead of <link>url</link> */
  atomStyle?: boolean;
}

export interface TrendStory {
  url: string;
  title: string;
  publishedAt: string;
  source: string;
  sourceDomain: string;
  category: string;
}

// ─── Source Registry — 25 Trusted Sources ────────────────────────────────────

const TRUSTED_RSS_SOURCES: RSSSource[] = [
  // ── Wire Services ──────────────────────────────────────────────────────────
  {
    name: "Reuters",
    url: "https://feeds.reuters.com/reuters/topNews",
    domain: "reuters.com",
    category: "World",
  },
  {
    name: "Associated Press",
    url: "https://rsshub.app/apnews/topics/apf-topnews",
    domain: "apnews.com",
    category: "World",
  },
  {
    name: "AFP World",
    url: "https://www.afp.com/en/actus/afp_en_internet_1/rss",
    domain: "afp.com",
    category: "World",
  },

  // ── English Broadsheets ────────────────────────────────────────────────────
  {
    name: "BBC News",
    url: "https://feeds.bbci.co.uk/news/world/rss.xml",
    domain: "bbc.com",
    category: "World",
  },
  {
    name: "The Guardian",
    url: "https://www.theguardian.com/world/rss",
    domain: "theguardian.com",
    category: "World",
  },
  {
    name: "NYT World",
    url: "https://rss.nytimes.com/services/xml/rss/nyt/World.xml",
    domain: "nytimes.com",
    category: "World",
  },
  {
    name: "WSJ World",
    url: "https://feeds.a.dj.com/rss/RSSWorldNews.xml",
    domain: "wsj.com",
    category: "Business",
  },
  {
    name: "Financial Times",
    url: "https://www.ft.com/rss/home/uk",
    domain: "ft.com",
    category: "Business",
    atomStyle: true,
  },
  {
    name: "The Telegraph",
    url: "https://www.telegraph.co.uk/rss.xml",
    domain: "telegraph.co.uk",
    category: "World",
  },
  {
    name: "The Independent",
    url: "https://www.independent.co.uk/rss",
    domain: "independent.co.uk",
    category: "World",
  },

  // ── The Economist ──────────────────────────────────────────────────────────
  {
    name: "The Economist",
    url: "https://www.economist.com/the-world-this-week/rss.xml",
    domain: "economist.com",
    category: "World",
    atomStyle: true,
  },
  {
    name: "Economist Finance",
    url: "https://www.economist.com/finance-and-economics/rss.xml",
    domain: "economist.com",
    category: "Business",
    atomStyle: true,
  },

  // ── European Press ─────────────────────────────────────────────────────────
  {
    name: "Le Monde (EN)",
    url: "https://www.lemonde.fr/en/rss/une.xml",
    domain: "lemonde.fr",
    category: "World",
  },
  {
    name: "Der Spiegel (EN)",
    url: "https://feeds.spiegel.de/rss/thema/schlagzeilen",
    domain: "spiegel.de",
    category: "World",
  },
  {
    name: "Euronews",
    url: "https://www.euronews.com/rss",
    domain: "euronews.com",
    category: "World",
  },

  // ── Tech Press ─────────────────────────────────────────────────────────────
  {
    name: "Ars Technica",
    url: "https://feeds.arstechnica.com/arstechnica/index",
    domain: "arstechnica.com",
    category: "Technology",
  },
  {
    name: "Wired",
    url: "https://www.wired.com/feed/rss",
    domain: "wired.com",
    category: "Technology",
  },
  {
    name: "MIT Tech Review",
    url: "https://www.technologyreview.com/feed/",
    domain: "technologyreview.com",
    category: "Technology",
  },
  {
    name: "The Verge",
    url: "https://www.theverge.com/rss/index.xml",
    domain: "theverge.com",
    category: "Technology",
    atomStyle: true,
  },

  // ── Science ────────────────────────────────────────────────────────────────
  {
    name: "Nature News",
    url: "https://www.nature.com/nature.rss",
    domain: "nature.com",
    category: "Science",
  },
  {
    name: "Scientific American",
    url: "https://www.scientificamerican.com/platform/syndication/rss/",
    domain: "scientificamerican.com",
    category: "Science",
  },

  // ── Business & Finance ─────────────────────────────────────────────────────
  {
    name: "Bloomberg",
    url: "https://feeds.bloomberg.com/markets/news.rss",
    domain: "bloomberg.com",
    category: "Business",
  },

  // ── Global South & Alternative Perspectives ───────────────────────────────
  {
    name: "Al Jazeera",
    url: "https://www.aljazeera.com/xml/rss/all.xml",
    domain: "aljazeera.com",
    category: "World",
  },
  {
    name: "South China Morning Post",
    url: "https://www.scmp.com/rss/91/feed",
    domain: "scmp.com",
    category: "World",
  },

  // ── Culture & Ideas ────────────────────────────────────────────────────────
  {
    name: "The Atlantic",
    url: "https://feeds.feedburner.com/TheAtlantic",
    domain: "theatlantic.com",
    category: "Culture",
  },

  // ── Sports (new in v1.5.1) ────────────────────────────────────────────────
  {
    name: "BBC Sport",
    url: "https://feeds.bbci.co.uk/sport/rss.xml",
    domain: "bbc.com",
    category: "Sports",
  },
  {
    name: "ESPN Top Headlines",
    url: "https://www.espn.com/espn/rss/news",
    domain: "espn.com",
    category: "Sports",
  },

  // ── Latin America & Global South (new in v1.5.1) ─────────────────────────
  {
    name: "Latin American Herald Tribune",
    url: "https://www.laht.com/rss.xml",
    domain: "laht.com",
    category: "World",
  },
  {
    name: "Merco Press",
    url: "https://en.mercopress.com/rss",
    domain: "mercopress.com",
    category: "World",
  },

  // ── Asia-Pacific (new in v1.5.1) ──────────────────────────────────────────
  {
    name: "The Japan Times",
    url: "https://www.japantimes.co.jp/feed",
    domain: "japantimes.co.jp",
    category: "World",
  },
  {
    name: "The Hindu",
    url: "https://www.thehindu.com/news/international/?service=rss",
    domain: "thehindu.com",
    category: "World",
  },

  // ── Health & Medicine (new in v1.5.1) ─────────────────────────────────────
  {
    name: "New Scientist",
    url: "https://www.newscientist.com/feed/home",
    domain: "newscientist.com",
    category: "Science",
  },
  {
    name: "Stat News",
    url: "https://www.statnews.com/feed/",
    domain: "statnews.com",
    category: "Health",
  },

  // ── Tech & Culture (new in v1.5.1) ────────────────────────────────────────
  {
    name: "Rest of World",
    url: "https://restofworld.org/feed/",
    domain: "restofworld.org",
    category: "Technology",
  },
];

// ─── Constants ────────────────────────────────────────────────────────────────

/** Stories older than this are never sent to the AI */
const MAX_AGE_HOURS = 72;

/** Hard cap on feed XML before regex — guards against ReDoS on huge/malformed feeds */
const MAX_FEED_BYTES = 100_000;

/** Max items per source before freshness filter */
const MAX_ITEMS_PER_SOURCE = 6;

// ─── XML Parsing ─────────────────────────────────────────────────────────────

/**
 * Extract a tag's text content, handling CDATA and plain text.
 * Uses non-crossing [^<]* instead of greedy [\s\S]*? to avoid ReDoS.
 */
function extractTag(xml: string, tag: string): string | null {
  const patterns = [
    new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`, "i"),
    new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, "i"),
  ];
  for (const re of patterns) {
    const m = xml.match(re);
    if (m) return m[1].trim().slice(0, 500);
  }
  return null;
}

/**
 * Atom-style link extraction: <link rel="alternate" href="https://..."/>
 * Required for FT, Economist, The Verge, and other Atom feeds.
 */
function extractAtomLink(itemXml: string): string | null {
  const m = itemXml.match(/<link[^>]+href="(https?:[^"]+)"/i);
  return m ? m[1] : null;
}

/** Parse all <item> blocks from RSS/Atom XML */
function extractItems(feedXml: string, atomStyle = false) {
  const safe = feedXml.slice(0, MAX_FEED_BYTES);
  const items: Array<{ title: string; link: string; pubDate: string }> = [];

  for (const match of safe.matchAll(/<item[^>]*>([\s\S]*?)<\/item>/gi)) {
    const xml = match[1];
    const title = extractTag(xml, "title") || "";
    const link = (
      extractTag(xml, "link") ||
      (atomStyle ? extractAtomLink(xml) : null) ||
      extractTag(xml, "guid") ||
      ""
    ).replace(/\s/g, "");
    const pubDate =
      extractTag(xml, "pubDate") ||
      extractTag(xml, "dc:date") ||
      extractTag(xml, "published") ||
      "";

    if (title && link.startsWith("http")) {
      items.push({ title, link, pubDate });
    }
  }
  return items;
}

function parseRSSDate(s: string): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

// ─── Deduplication ────────────────────────────────────────────────────────────

/**
 * Normalize title for similarity comparison.
 * Catches wire story duplicates (Reuters + AP running the same headline).
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
        "User-Agent": "CupOfNews-Bot/0.4 (RSS; https://github.com/paulfxyz/cup-of-news)",
        "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) return [];

    const xml = await res.text();
    const items = extractItems(xml, source.atomStyle);
    const cutoff = new Date(Date.now() - MAX_AGE_HOURS * 3_600_000);

    return items
      .filter(item => {
        if (!item.pubDate) return true;
        const d = parseRSSDate(item.pubDate);
        return d ? d > cutoff : true;
      })
      .slice(0, MAX_ITEMS_PER_SOURCE)
      .map(item => ({
        url: item.link,
        title: item.title,
        publishedAt: item.pubDate || new Date().toISOString(),
        source: source.name,
        sourceDomain: source.domain,
        category: source.category,
      }));
  } catch {
    // Silent failure — one dead source doesn't block the pipeline
    return [];
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetch trending stories from all 25 RSS sources in parallel.
 *
 * Results are interleaved round-robin (1 per source per pass) to maximize
 * editorial diversity before truncation. A pool of 3× needed is returned
 * so the AI has plenty to rank and select from.
 */
export async function fetchTrendingStories(needed = 20): Promise<TrendStory[]> {
  if (needed <= 0) return [];

  console.log(`📡 Fetching from ${TRUSTED_RSS_SOURCES.length} RSS sources…`);

  const settled = await Promise.allSettled(
    TRUSTED_RSS_SOURCES.map(s => fetchFeed(s))
  );

  // Round-robin interleave for diversity
  const buckets = settled
    .filter((r): r is PromiseFulfilledResult<TrendStory[]> => r.status === "fulfilled" && r.value.length > 0)
    .map(r => r.value);

  const interleaved: TrendStory[] = [];
  const maxLen = Math.max(...buckets.map(b => b.length), 0);
  for (let i = 0; i < maxLen; i++) {
    for (const bucket of buckets) {
      if (bucket[i]) interleaved.push(bucket[i]);
    }
  }

  // Two-pass dedup: URL then title prefix
  const seenUrls = new Set<string>();
  const seenTitles = new Set<string>();
  const deduped = interleaved.filter(s => {
    if (seenUrls.has(s.url)) return false;
    const nt = normTitle(s.title);
    if (seenTitles.has(nt)) return false;
    seenUrls.add(s.url);
    seenTitles.add(nt);
    return true;
  });

  const sourceCount = buckets.length;
  console.log(`📡 Trend pool: ${deduped.length} stories from ${sourceCount}/${TRUSTED_RSS_SOURCES.length} sources`);

  return deduped.slice(0, Math.max(needed * 3, 30));
}
