/**
 * @file server/trends.ts
 * @author Paul Fleury <hello@paulfleury.com>
 * @version 2.0.0
 *
 * Cup of News — RSS Trend Fallback Engine (Edition-Aware)
 *
 * WHY THIS EXISTS:
 *   Cup of News works best when you submit your own links. But a great morning
 *   briefing shouldn't fail just because you didn't bookmark anything this week.
 *   This module provides a safety net: trusted RSS sources per edition that
 *   ensure every morning has at least 20 stories worth reading.
 *
 * v2.0.0 CHANGES — EDITION-AWARE SOURCE SETS:
 *   Each of the 8 editions now has its own curated RSS source list:
 *   - English editions (World, US, CA, GB, AU) use English-language feeds
 *     filtered by regional relevance
 *   - French editions (fr-FR, fr-CA) use French-language primary feeds
 *     (Le Monde, Le Figaro, RFI, France 24, Radio-Canada, Le Devoir)
 *     plus global wire services for international context
 *   - German edition (de-DE) uses German-language primary feeds
 *     (Der Spiegel DE, Süddeutsche Zeitung, FAZ, DW, Zeit Online)
 *     plus global wire services
 *
 * CHALLENGE — FRENCH/GERMAN RSS RELIABILITY:
 *   French and German newspaper RSS feeds are less reliably maintained than
 *   Anglo-Saxon equivalents. Key issues encountered:
 *   - Le Figaro: changed RSS URLs several times; using /rss/ root which is stable
 *   - Libération: RSS has been intermittent; not included as primary
 *   - FAZ: RSS format is non-standard Atom; atomStyle = true required
 *   - Süddeutsche: RSS URL changed in 2023; confirmed current URL
 *   - DW (Deutsche Welle): most reliable German feed — multiple topic RSS feeds
 *   Strategy: prefer RFI (French) and DW (German) as anchor feeds since they
 *   are international broadcasters with explicitly maintained public RSS.
 *
 * DESIGN DECISIONS (unchanged from v1.x):
 *   - No API keys required. Pure public RSS/Atom feeds only. Zero cost.
 *   - Stories older than 72 hours are discarded.
 *   - Round-robin interleaving ensures no single source dominates.
 *   - Two-pass dedup: URL exact match + normalized title prefix.
 *   - MAX_FEED_BYTES = 100KB guards against ReDoS on malformed XML.
 *
 * PUBLIC API:
 *   fetchTrendingStories(needed, editionId) — fetch RSS stories for a given edition
 *   EDITION_RSS_SOURCES — exported map of edition ID → source list (for admin UI)
 */

// ─── Types ────────────────────────────────────────────────────────────────────

interface RSSSource {
  name: string;
  url: string;
  domain: string;
  category: string;
  /** Some feeds use Atom <link href="..."/> instead of <link>url</link> */
  atomStyle?: boolean;
  /** ISO 639-1 language code — for logging and future filtering */
  lang?: string;
}

export interface TrendStory {
  url: string;
  title: string;
  publishedAt: string;
  source: string;
  sourceDomain: string;
  category: string;
}

// ─── Wire Services (shared across all editions) ──────────────────────────────
// These are always included because they provide authoritative global coverage
// regardless of edition. The AI will summarise them in the edition's language.

const WIRE_SERVICES: RSSSource[] = [
  {
    name: "Reuters",
    url: "https://feeds.reuters.com/reuters/topNews",
    domain: "reuters.com",
    category: "World",
    lang: "en",
  },
  {
    name: "Associated Press",
    url: "https://rsshub.app/apnews/topics/apf-topnews",
    domain: "apnews.com",
    category: "World",
    lang: "en",
  },
  {
    name: "AFP World",
    url: "https://www.afp.com/en/actus/afp_en_internet_1/rss",
    domain: "afp.com",
    category: "World",
    lang: "en",
  },
];

// ─── English Global Sources (en-WORLD baseline) ───────────────────────────────

const EN_GLOBAL_SOURCES: RSSSource[] = [
  ...WIRE_SERVICES,
  // Broadsheets
  { name: "BBC News", url: "https://feeds.bbci.co.uk/news/world/rss.xml", domain: "bbc.com", category: "World", lang: "en" },
  { name: "The Guardian", url: "https://www.theguardian.com/world/rss", domain: "theguardian.com", category: "World", lang: "en" },
  { name: "NYT World", url: "https://rss.nytimes.com/services/xml/rss/nyt/World.xml", domain: "nytimes.com", category: "World", lang: "en" },
  { name: "WSJ World", url: "https://feeds.a.dj.com/rss/RSSWorldNews.xml", domain: "wsj.com", category: "Business", lang: "en" },
  { name: "Financial Times", url: "https://www.ft.com/rss/home/uk", domain: "ft.com", category: "Business", atomStyle: true, lang: "en" },
  { name: "The Telegraph", url: "https://www.telegraph.co.uk/rss.xml", domain: "telegraph.co.uk", category: "World", lang: "en" },
  { name: "The Independent", url: "https://www.independent.co.uk/rss", domain: "independent.co.uk", category: "World", lang: "en" },
  { name: "The Economist", url: "https://www.economist.com/the-world-this-week/rss.xml", domain: "economist.com", category: "World", atomStyle: true, lang: "en" },
  { name: "Economist Finance", url: "https://www.economist.com/finance-and-economics/rss.xml", domain: "economist.com", category: "Business", atomStyle: true, lang: "en" },
  // European press (EN)
  { name: "Le Monde (EN)", url: "https://www.lemonde.fr/en/rss/une.xml", domain: "lemonde.fr", category: "World", lang: "en" },
  { name: "Der Spiegel (EN)", url: "https://feeds.spiegel.de/rss/thema/schlagzeilen", domain: "spiegel.de", category: "World", lang: "en" },
  { name: "Euronews", url: "https://www.euronews.com/rss", domain: "euronews.com", category: "World", lang: "en" },
  // Tech
  { name: "Ars Technica", url: "https://feeds.arstechnica.com/arstechnica/index", domain: "arstechnica.com", category: "Technology", lang: "en" },
  { name: "Wired", url: "https://www.wired.com/feed/rss", domain: "wired.com", category: "Technology", lang: "en" },
  { name: "MIT Tech Review", url: "https://www.technologyreview.com/feed/", domain: "technologyreview.com", category: "Technology", lang: "en" },
  { name: "The Verge", url: "https://www.theverge.com/rss/index.xml", domain: "theverge.com", category: "Technology", atomStyle: true, lang: "en" },
  // Science
  { name: "Nature News", url: "https://www.nature.com/nature.rss", domain: "nature.com", category: "Science", lang: "en" },
  { name: "Scientific American", url: "https://www.scientificamerican.com/platform/syndication/rss/", domain: "scientificamerican.com", category: "Science", lang: "en" },
  { name: "New Scientist", url: "https://www.newscientist.com/feed/home", domain: "newscientist.com", category: "Science", lang: "en" },
  // Business
  { name: "Bloomberg", url: "https://feeds.bloomberg.com/markets/news.rss", domain: "bloomberg.com", category: "Business", lang: "en" },
  // Global South
  { name: "Al Jazeera", url: "https://www.aljazeera.com/xml/rss/all.xml", domain: "aljazeera.com", category: "World", lang: "en" },
  { name: "South China Morning Post", url: "https://www.scmp.com/rss/91/feed", domain: "scmp.com", category: "World", lang: "en" },
  { name: "The Atlantic", url: "https://feeds.feedburner.com/TheAtlantic", domain: "theatlantic.com", category: "Culture", lang: "en" },
  // Sports
  { name: "BBC Sport", url: "https://feeds.bbci.co.uk/sport/rss.xml", domain: "bbc.com", category: "Sports", lang: "en" },
  { name: "ESPN Top Headlines", url: "https://www.espn.com/espn/rss/news", domain: "espn.com", category: "Sports", lang: "en" },
  // Latin America
  { name: "Latin American Herald Tribune", url: "https://www.laht.com/rss.xml", domain: "laht.com", category: "World", lang: "en" },
  { name: "Merco Press", url: "https://en.mercopress.com/rss", domain: "mercopress.com", category: "World", lang: "en" },
  // Asia-Pacific
  { name: "The Japan Times", url: "https://www.japantimes.co.jp/feed", domain: "japantimes.co.jp", category: "World", lang: "en" },
  { name: "The Hindu", url: "https://www.thehindu.com/news/international/?service=rss", domain: "thehindu.com", category: "World", lang: "en" },
  // Health
  { name: "Stat News", url: "https://www.statnews.com/feed/", domain: "statnews.com", category: "Health", lang: "en" },
  { name: "Rest of World", url: "https://restofworld.org/feed/", domain: "restofworld.org", category: "Technology", lang: "en" },
];

// ─── US-specific additions ─────────────────────────────────────────────────────
const EN_US_EXTRA: RSSSource[] = [
  { name: "NPR News", url: "https://feeds.npr.org/1001/rss.xml", domain: "npr.org", category: "World", lang: "en" },
  { name: "Washington Post", url: "https://feeds.washingtonpost.com/rss/world", domain: "washingtonpost.com", category: "Politics", lang: "en" },
  { name: "Politico", url: "https://rss.politico.com/politics-news.xml", domain: "politico.com", category: "Politics", lang: "en" },
  { name: "The Hill", url: "https://thehill.com/rss/syndicator/19110", domain: "thehill.com", category: "Politics", lang: "en" },
  { name: "ESPN NFL", url: "https://www.espn.com/espn/rss/nfl/news", domain: "espn.com", category: "Sports", lang: "en" },
  { name: "ESPN NBA", url: "https://www.espn.com/espn/rss/nba/news", domain: "espn.com", category: "Sports", lang: "en" },
];

// ─── UK-specific additions ────────────────────────────────────────────────────
const EN_GB_EXTRA: RSSSource[] = [
  { name: "BBC Politics", url: "https://feeds.bbci.co.uk/news/politics/rss.xml", domain: "bbc.com", category: "Politics", lang: "en" },
  { name: "Sky News", url: "https://feeds.skynews.com/feeds/rss/home.xml", domain: "news.sky.com", category: "World", lang: "en" },
  { name: "The Times UK", url: "https://www.thetimes.co.uk/rss", domain: "thetimes.co.uk", category: "World", lang: "en" },
  { name: "BBC Sport Cricket", url: "https://feeds.bbci.co.uk/sport/cricket/rss.xml", domain: "bbc.com", category: "Sports", lang: "en" },
  { name: "Sky Sports", url: "https://www.skysports.com/rss/12040", domain: "skysports.com", category: "Sports", lang: "en" },
];

// ─── Canadian English additions ───────────────────────────────────────────────
const EN_CA_EXTRA: RSSSource[] = [
  { name: "CBC News", url: "https://www.cbc.ca/cmlink/rss-topstories", domain: "cbc.ca", category: "World", lang: "en" },
  { name: "Globe and Mail", url: "https://www.theglobeandmail.com/arc/outboundfeeds/rss/category/canada/", domain: "theglobeandmail.com", category: "World", lang: "en" },
  { name: "Toronto Star", url: "https://www.thestar.com/search/?f=rss&t=article&c=news*&l=50&s=start_time&sd=desc", domain: "thestar.com", category: "World", lang: "en" },
  { name: "National Post", url: "https://nationalpost.com/feed", domain: "nationalpost.com", category: "World", lang: "en" },
  { name: "Sportsnet NHL", url: "https://www.sportsnet.ca/hockey/rss", domain: "sportsnet.ca", category: "Sports", lang: "en" },
];

// ─── Australian additions ─────────────────────────────────────────────────────
const EN_AU_EXTRA: RSSSource[] = [
  { name: "ABC Australia", url: "https://www.abc.net.au/news/feed/51120/rss.xml", domain: "abc.net.au", category: "World", lang: "en" },
  { name: "The Australian", url: "https://www.theaustralian.com.au/feed", domain: "theaustralian.com.au", category: "World", lang: "en" },
  { name: "Sydney Morning Herald", url: "https://www.smh.com.au/rss/feed.xml", domain: "smh.com.au", category: "World", lang: "en" },
  { name: "Guardian Australia", url: "https://www.theguardian.com/australia-news/rss", domain: "theguardian.com", category: "World", lang: "en" },
  // Strong Asia-Pacific because Australia is in the region
  { name: "South China Morning Post", url: "https://www.scmp.com/rss/91/feed", domain: "scmp.com", category: "World", lang: "en" },
  { name: "Japan Times", url: "https://www.japantimes.co.jp/feed", domain: "japantimes.co.jp", category: "World", lang: "en" },
  // AFL/NRL/Cricket
  { name: "Fox Sports AU", url: "https://www.foxsports.com.au/rss", domain: "foxsports.com.au", category: "Sports", lang: "en" },
];

// ─── French-language sources (fr-FR and fr-CA both use these) ─────────────────
/**
 * Challenge: French newspaper RSS is less standardised than English equivalents.
 * Several major outlets (Libération, Les Échos) have intermittent RSS.
 * Strategy: anchor on RFI and France 24 (international broadcasters with
 * professionally maintained RSS), complement with Le Monde and Le Figaro.
 *
 * RFI (Radio France Internationale) is the most reliable:
 * - Publicly funded, internationally oriented, RSS always active
 * - Covers Africa, Europe, Americas in French — great for diversity
 *
 * France 24: similar profile to RFI, reliable RSS, multi-topic feeds
 *
 * Le Monde: flagship French newspaper, RSS is stable at /rss/une.xml
 *
 * Le Figaro: conservative flagship, RSS available but URL changed in 2022
 *   — using /rss/ which aggregates all sections
 */
const FR_PRIMARY_SOURCES: RSSSource[] = [
  // ── Wire services in French ─────────────────────────────────────────────────
  ...WIRE_SERVICES, // Reuters/AP/AFP: AI will summarise in French regardless

  // ── French-language anchor feeds ───────────────────────────────────────────
  {
    name: "RFI Actualités",
    url: "https://www.rfi.fr/fr/rss",
    domain: "rfi.fr",
    category: "World",
    lang: "fr",
  },
  {
    name: "France 24",
    url: "https://www.france24.com/fr/rss",
    domain: "france24.com",
    category: "World",
    lang: "fr",
  },
  {
    name: "Le Monde",
    url: "https://www.lemonde.fr/rss/une.xml",
    domain: "lemonde.fr",
    category: "World",
    lang: "fr",
  },
  {
    name: "Le Figaro",
    url: "https://www.lefigaro.fr/rss/figaro_actualites.xml",
    domain: "lefigaro.fr",
    category: "World",
    lang: "fr",
  },
  {
    name: "Le Monde Politique",
    url: "https://www.lemonde.fr/politique/rss_full.xml",
    domain: "lemonde.fr",
    category: "Politics",
    lang: "fr",
  },
  {
    name: "Le Monde Économie",
    url: "https://www.lemonde.fr/economie/rss_full.xml",
    domain: "lemonde.fr",
    category: "Business",
    lang: "fr",
  },
  {
    name: "Le Monde Culture",
    url: "https://www.lemonde.fr/culture/rss_full.xml",
    domain: "lemonde.fr",
    category: "Culture",
    lang: "fr",
  },
  {
    name: "L'Équipe",
    url: "https://www.lequipe.fr/rss/actu_rss.xml",
    domain: "lequipe.fr",
    category: "Sports",
    lang: "fr",
  },
  {
    name: "Sciences et Avenir",
    url: "https://www.sciencesetavenir.fr/rss.xml",
    domain: "sciencesetavenir.fr",
    category: "Science",
    lang: "fr",
  },
  {
    name: "Les Échos",
    url: "https://syndication.lesechos.fr/rss/rss_la_une.xml",
    domain: "lesechos.fr",
    category: "Business",
    lang: "fr",
  },
  {
    name: "France Info",
    url: "https://www.francetvinfo.fr/titres.rss",
    domain: "francetvinfo.fr",
    category: "World",
    lang: "fr",
  },
  // ── Francophone Africa & world ──────────────────────────────────────────────
  {
    name: "Jeune Afrique",
    url: "https://www.jeuneafrique.com/feed/",
    domain: "jeuneafrique.com",
    category: "World",
    lang: "fr",
  },
  // ── English international for global context ────────────────────────────────
  { name: "BBC News", url: "https://feeds.bbci.co.uk/news/world/rss.xml", domain: "bbc.com", category: "World", lang: "en" },
  { name: "The Economist", url: "https://www.economist.com/the-world-this-week/rss.xml", domain: "economist.com", category: "World", atomStyle: true, lang: "en" },
  { name: "Al Jazeera", url: "https://www.aljazeera.com/xml/rss/all.xml", domain: "aljazeera.com", category: "World", lang: "en" },
];

// ─── French-Canadian specific additions ──────────────────────────────────────
const FR_CA_EXTRA: RSSSource[] = [
  {
    name: "Radio-Canada",
    url: "https://ici.radio-canada.ca/rss/4159",
    domain: "radio-canada.ca",
    category: "World",
    lang: "fr",
  },
  {
    name: "Le Devoir",
    url: "https://www.ledevoir.com/rss/manchettes.xml",
    domain: "ledevoir.com",
    category: "World",
    lang: "fr",
  },
  {
    name: "La Presse",
    url: "https://www.lapresse.ca/actualites/rss",
    domain: "lapresse.ca",
    category: "World",
    lang: "fr",
  },
  {
    name: "Journal de Montréal",
    url: "https://www.journaldemontreal.com/api/rss",
    domain: "journaldemontreal.com",
    category: "World",
    lang: "fr",
  },
  // Hockey — mandatory for francophone Canada
  {
    name: "RDS (sport)",
    url: "https://www.rds.ca/rss",
    domain: "rds.ca",
    category: "Sports",
    lang: "fr",
  },
];

// ─── German-language sources ──────────────────────────────────────────────────
/**
 * Challenge: German newspaper RSS feeds.
 * - FAZ: Atom format, atomStyle required; URL stable at https://www.faz.net/rss/aktuell/
 * - Süddeutsche: SZ.de RSS changed structure in 2023; using /rss/uebersicht.rss
 * - Zeit Online: reliable at https://newsfeed.zeit.de/all
 * - DW: most reliable German feed; multiple topical sub-feeds available
 * - Der Spiegel DE: German edition at spiegel.de/schlagzeilen/rss
 * - Handelsblatt: business-focused, reliable RSS
 *
 * DW (Deutsche Welle) is the anchor — publicly funded, internationally
 * maintained, excellent RSS discipline. Covers Germany + global news in German.
 */
const DE_PRIMARY_SOURCES: RSSSource[] = [
  // ── Wire services ────────────────────────────────────────────────────────────
  ...WIRE_SERVICES, // AI will summarise in German

  // ── German-language anchor feeds ─────────────────────────────────────────────
  {
    name: "Deutsche Welle",
    url: "https://rss.dw.com/rdf/rss-de-all",
    domain: "dw.com",
    category: "World",
    lang: "de",
  },
  {
    name: "DW Wirtschaft",
    url: "https://rss.dw.com/rdf/rss-de-wirtschaft",
    domain: "dw.com",
    category: "Business",
    lang: "de",
  },
  {
    name: "Der Spiegel",
    url: "https://www.spiegel.de/schlagzeilen/index.rss",
    domain: "spiegel.de",
    category: "World",
    lang: "de",
  },
  {
    name: "Spiegel Politik",
    url: "https://www.spiegel.de/politik/index.rss",
    domain: "spiegel.de",
    category: "Politics",
    lang: "de",
  },
  {
    name: "Spiegel Wirtschaft",
    url: "https://www.spiegel.de/wirtschaft/index.rss",
    domain: "spiegel.de",
    category: "Business",
    lang: "de",
  },
  {
    name: "Zeit Online",
    url: "https://newsfeed.zeit.de/all",
    domain: "zeit.de",
    category: "World",
    lang: "de",
  },
  {
    name: "Süddeutsche Zeitung",
    url: "https://rss.sueddeutsche.de/rss/Topthemen",
    domain: "sueddeutsche.de",
    category: "World",
    lang: "de",
  },
  {
    name: "FAZ Aktuell",
    url: "https://www.faz.net/rss/aktuell/",
    domain: "faz.net",
    category: "World",
    atomStyle: true,
    lang: "de",
  },
  {
    name: "Handelsblatt",
    url: "https://www.handelsblatt.com/contentexport/feed/schlagzeilen",
    domain: "handelsblatt.com",
    category: "Business",
    lang: "de",
  },
  {
    name: "Tagesspiegel",
    url: "https://www.tagesspiegel.de/contentexport/feed/home",
    domain: "tagesspiegel.de",
    category: "World",
    lang: "de",
  },
  {
    name: "Kicker (Sport)",
    url: "https://www.kicker.de/news/fussball/bundesliga/news.rss",
    domain: "kicker.de",
    category: "Sports",
    lang: "de",
  },
  {
    name: "SportBILD",
    url: "https://sport.bild.de/rss-feeds/sport-news/sport-news-37830028.xml",
    domain: "bild.de",
    category: "Sports",
    lang: "de",
  },
  {
    name: "Spektrum (Wissenschaft)",
    url: "https://www.spektrum.de/alias/rss/spektrum-de-rss-feed/996406",
    domain: "spektrum.de",
    category: "Science",
    lang: "de",
  },
  // ── English international for global context ────────────────────────────────
  { name: "BBC News", url: "https://feeds.bbci.co.uk/news/world/rss.xml", domain: "bbc.com", category: "World", lang: "en" },
  { name: "Financial Times", url: "https://www.ft.com/rss/home/uk", domain: "ft.com", category: "Business", atomStyle: true, lang: "en" },
  { name: "The Economist", url: "https://www.economist.com/the-world-this-week/rss.xml", domain: "economist.com", category: "World", atomStyle: true, lang: "en" },
];

// ─── Edition Source Map ───────────────────────────────────────────────────────
/**
 * Maps edition ID → RSS source list.
 * Edition-specific lists supplement the global baseline.
 * Exported so the admin UI can show which sources feed each edition.
 */
export const EDITION_RSS_SOURCES: Record<string, RSSSource[]> = {
  "en-WORLD": EN_GLOBAL_SOURCES,
  "en-US":    [...EN_GLOBAL_SOURCES, ...EN_US_EXTRA],
  "en-CA":    [...EN_GLOBAL_SOURCES, ...EN_CA_EXTRA],
  "en-GB":    [...EN_GLOBAL_SOURCES, ...EN_GB_EXTRA],
  "en-AU":    [...EN_GLOBAL_SOURCES, ...EN_AU_EXTRA],
  "fr-FR":    [...FR_PRIMARY_SOURCES],
  "fr-CA":    [...FR_PRIMARY_SOURCES, ...FR_CA_EXTRA],
  "de-DE":    [...DE_PRIMARY_SOURCES],
};

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
 * Required for FT, Economist, The Verge, FAZ, and other Atom feeds.
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
 * Works across French and German titles too — lowercasing handles accents
 * sufficiently for dedup purposes (exact dedup, not fuzzy).
 */
function normTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\u00e0-\u024f ]/g, "")  // keep latin extended chars (é, ü, ö etc.)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

// ─── Feed Fetcher ─────────────────────────────────────────────────────────────

async function fetchFeed(source: RSSSource): Promise<TrendStory[]> {
  try {
    const res = await fetch(source.url, {
      headers: {
        "User-Agent": "CupOfNews-Bot/2.0 (RSS; https://github.com/paulfxyz/cup-of-news)",
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
 * Fetch trending stories from the appropriate RSS sources for the given edition.
 *
 * v2.0.0: editionId parameter selects the correct source set.
 * Falls back to en-WORLD sources if edition not recognised.
 *
 * Results are interleaved round-robin (1 per source per pass) to maximize
 * editorial diversity before truncation.
 */
export async function fetchTrendingStories(
  needed = 20,
  editionId = "en-WORLD"
): Promise<TrendStory[]> {
  if (needed <= 0) return [];

  const sources = EDITION_RSS_SOURCES[editionId] ?? EDITION_RSS_SOURCES["en-WORLD"];
  console.log(`📡 [${editionId}] Fetching from ${sources.length} RSS sources…`);

  const settled = await Promise.allSettled(sources.map(s => fetchFeed(s)));

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
  console.log(`📡 [${editionId}] Trend pool: ${deduped.length} stories from ${sourceCount}/${sources.length} sources`);

  return deduped.slice(0, Math.max(needed * 3, 30));
}
