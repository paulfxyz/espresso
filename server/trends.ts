/**
 * @file server/trends.ts
 * @author Paul Fleury <hello@paulfleury.com>
 * @version 3.2.3
 *
 * Cup of News — RSS Trend Fallback Engine (Edition-Aware)
 *
 * WHY THIS EXISTS:
 *   Cup of News works best when you submit your own links. But a great morning
 *   briefing shouldn't fail just because you didn't bookmark anything this week.
 *   This module provides a safety net: trusted RSS sources per edition that
 *   ensure every morning has at least 20 stories worth reading.
 *
 * v3.0.0 CHANGES — 7-LANGUAGE EXPANSION:
 *   Spanish, Portuguese, Chinese, Russian, Turkish, and Italian editions added,
 *   each with their own curated native-language RSS source pools.
 *   The 8 legacy edition aliases (en-WORLD, en-US, en-GB, etc.) have been removed
 *   — those editions no longer exist.
 *
 * v3.1.0 CHANGES — 9-LANGUAGE EXPANSION:
 *   Turkish (tr) and Italian (it) editions added. Each has its own native-language
 *   RSS source pool designed to reflect authentic journalism from those cultures.
 *
 *   CHALLENGE — TURKISH RSS:
 *   Major Turkish outlets (Hürriyet, Sabah, Cumhuriyet) publish RSS but quality
 *   and freshness vary. We prefer TRT World (English arm of TRT, publicly funded
 *   international broadcaster), DW Turkish, and BBC Turkish for reliability.
 *   Bianet is included as the primary independent investigative source.
 *
 *   CHALLENGE — ITALIAN RSS:
 *   Italian media has strong RSS culture. ANSA (the wire agency) and Corriere della
 *   Sera are the most reliable. La Repubblica and Il Sole 24 Ore (financial daily)
 *   round out politics + business. RAI News covers broadcast. Gazzetta dello Sport
 *   for the obligatory calcio slot.
 *
 *   Only 9 canonical edition IDs are supported: en, fr, de, es, pt, zh, ru, tr, it.
 *
 *   The design principle is unchanged: native-language sources must dominate
 *   each edition's pool (>80%). English wire services appear only as a minimal
 *   global context layer at the end of each non-English pool. This ensures the
 *   AI summarises authentic journalism, not English-to-target-language translations.
 *
 * CHALLENGE — NON-LATIN RSS FEEDS:
 *   Chinese feeds: Most major Chinese mainland outlets don't publish open RSS.
 *   Solution: use BBC Chinese, DW Chinese, RFI Chinese, Radio Free Asia — all
 *   international public broadcasters with stable RSS and no paywalls.
 *
 *   Russian feeds: Post-2022, several independent Russian outlets moved offshore.
 *   Meduza (Latvia), The Insider (Riga), iStories all publish RSS. BBC Russian
 *   Service and DW Russian are stable international broadcaster feeds.
 *   We exclude state-controlled TASS/RIA — they do not produce independent journalism.
 *
 *   Spanish/Portuguese: Large, competitive media landscape with reliable RSS.
 *   El País, EFE, G1, Folha are professionally maintained.
 *
 * CHALLENGE — PORTUGUESE: BRAZIL vs PORTUGAL:
 *   Brazil (210M speakers) and Portugal (10M) have different news cycles, spelling
 *   conventions, and editorial voices. Rather than two editions, we use one "pt"
 *   edition that draws from BOTH Brazilian and Portuguese sources equally, then
 *   lets the AI blend the two perspectives into a single digest.
 *
 * DESIGN DECISIONS (unchanged):
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

// ─── English Global Sources ───────────────────────────────────────────────────

const EN_GLOBAL_SOURCES: RSSSource[] = [
  // Wire services
  { name: "Reuters", url: "https://feeds.reuters.com/reuters/topNews", domain: "reuters.com", category: "World", lang: "en" },
  { name: "Associated Press", url: "https://rsshub.app/apnews/topics/apf-topnews", domain: "apnews.com", category: "World", lang: "en" },
  { name: "AFP World", url: "https://www.afp.com/en/actus/afp_en_internet_1/rss", domain: "afp.com", category: "World", lang: "en" },
  // Broadsheets
  { name: "BBC News", url: "https://feeds.bbci.co.uk/news/world/rss.xml", domain: "bbc.com", category: "World", lang: "en" },
  { name: "The Guardian", url: "https://www.theguardian.com/world/rss", domain: "theguardian.com", category: "World", lang: "en" },
  { name: "NYT World", url: "https://rss.nytimes.com/services/xml/rss/nyt/World.xml", domain: "nytimes.com", category: "World", lang: "en" },
  { name: "WSJ World", url: "https://feeds.a.dj.com/rss/RSSWorldNews.xml", domain: "wsj.com", category: "Business", lang: "en" },
  { name: "Financial Times", url: "https://www.ft.com/rss/home/uk", domain: "ft.com", category: "Business", atomStyle: true, lang: "en" },
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

// ─── French Sources ────────────────────────────────────────────────────────────
/**
 * Challenge: French newspaper RSS is less standardised than English.
 * Strategy: anchor on RFI and France 24 (international broadcasters with
 * professionally maintained RSS), complement with Le Monde and Le Figaro.
 * AFP French-language wire is first — it covers the whole spectrum.
 */
const FR_PRIMARY_SOURCES: RSSSource[] = [
  { name: "AFP FR", url: "https://www.afp.com/fr/actus/afp_fr_internet_4/rss", domain: "afp.com", category: "World", lang: "fr" },
  { name: "RFI Actualités", url: "https://www.rfi.fr/fr/rss", domain: "rfi.fr", category: "World", lang: "fr" },
  { name: "France 24", url: "https://www.france24.com/fr/rss", domain: "france24.com", category: "World", lang: "fr" },
  { name: "Le Monde", url: "https://www.lemonde.fr/rss/une.xml", domain: "lemonde.fr", category: "World", lang: "fr" },
  { name: "Le Figaro", url: "https://www.lefigaro.fr/rss/figaro_actualites.xml", domain: "lefigaro.fr", category: "World", lang: "fr" },
  { name: "Le Monde Politique", url: "https://www.lemonde.fr/politique/rss_full.xml", domain: "lemonde.fr", category: "Politics", lang: "fr" },
  { name: "Le Monde Économie", url: "https://www.lemonde.fr/economie/rss_full.xml", domain: "lemonde.fr", category: "Business", lang: "fr" },
  { name: "Le Monde Culture", url: "https://www.lemonde.fr/culture/rss_full.xml", domain: "lemonde.fr", category: "Culture", lang: "fr" },
  { name: "L'Équipe", url: "https://www.lequipe.fr/rss/actu_rss.xml", domain: "lequipe.fr", category: "Sports", lang: "fr" },
  { name: "Sciences et Avenir", url: "https://www.sciencesetavenir.fr/rss.xml", domain: "sciencesetavenir.fr", category: "Science", lang: "fr" },
  { name: "Les Échos", url: "https://syndication.lesechos.fr/rss/rss_la_une.xml", domain: "lesechos.fr", category: "Business", lang: "fr" },
  { name: "France Info", url: "https://www.francetvinfo.fr/titres.rss", domain: "francetvinfo.fr", category: "World", lang: "fr" },
  { name: "Jeune Afrique", url: "https://www.jeuneafrique.com/feed/", domain: "jeuneafrique.com", category: "World", lang: "fr" },
  // English wire: global context only, kept minimal
  { name: "Reuters", url: "https://feeds.reuters.com/reuters/topNews", domain: "reuters.com", category: "World", lang: "en" },
  { name: "BBC News", url: "https://feeds.bbci.co.uk/news/world/rss.xml", domain: "bbc.com", category: "World", lang: "en" },
];

// ─── German Sources ────────────────────────────────────────────────────────────
/**
 * Challenge: FAZ uses Atom format (atomStyle: true). DW is the most reliable
 * German feed — publicly funded, internationally maintained.
 */
const DE_PRIMARY_SOURCES: RSSSource[] = [
  { name: "Deutsche Welle", url: "https://rss.dw.com/rdf/rss-de-all", domain: "dw.com", category: "World", lang: "de" },
  { name: "DW Wirtschaft", url: "https://rss.dw.com/rdf/rss-de-wirtschaft", domain: "dw.com", category: "Business", lang: "de" },
  { name: "Der Spiegel", url: "https://www.spiegel.de/schlagzeilen/index.rss", domain: "spiegel.de", category: "World", lang: "de" },
  { name: "Spiegel Politik", url: "https://www.spiegel.de/politik/index.rss", domain: "spiegel.de", category: "Politics", lang: "de" },
  { name: "Spiegel Wirtschaft", url: "https://www.spiegel.de/wirtschaft/index.rss", domain: "spiegel.de", category: "Business", lang: "de" },
  { name: "Zeit Online", url: "https://newsfeed.zeit.de/all", domain: "zeit.de", category: "World", lang: "de" },
  { name: "Süddeutsche Zeitung", url: "https://rss.sueddeutsche.de/rss/Topthemen", domain: "sueddeutsche.de", category: "World", lang: "de" },
  { name: "FAZ Aktuell", url: "https://www.faz.net/rss/aktuell/", domain: "faz.net", category: "World", atomStyle: true, lang: "de" },
  { name: "Handelsblatt", url: "https://www.handelsblatt.com/contentexport/feed/schlagzeilen", domain: "handelsblatt.com", category: "Business", lang: "de" },
  { name: "Tagesspiegel", url: "https://www.tagesspiegel.de/contentexport/feed/home", domain: "tagesspiegel.de", category: "World", lang: "de" },
  { name: "Kicker (Sport)", url: "https://www.kicker.de/news/fussball/bundesliga/news.rss", domain: "kicker.de", category: "Sports", lang: "de" },
  { name: "Spektrum (Wissenschaft)", url: "https://www.spektrum.de/alias/rss/spektrum-de-rss-feed/996406", domain: "spektrum.de", category: "Science", lang: "de" },
  // English wire: minimal
  { name: "Reuters", url: "https://feeds.reuters.com/reuters/topNews", domain: "reuters.com", category: "World", lang: "en" },
  { name: "BBC News", url: "https://feeds.bbci.co.uk/news/world/rss.xml", domain: "bbc.com", category: "World", lang: "en" },
];

// ─── Spanish Sources ───────────────────────────────────────────────────────────
/**
 * Challenge: Covering both Spain and Latin America (20 countries, vastly different
 * political situations). Strategy: use EFE (Spanish wire) + BBC Mundo + DW Español
 * as cross-continental anchors, then add national outlets for Spain and major LATAM
 * countries.
 *
 * El País is available internationally and covers Spain + LATAM.
 * BBC Mundo covers Latin America specifically.
 * EFE is the Spanish wire service — equivalent to AFP for French editions.
 */
const ES_PRIMARY_SOURCES: RSSSource[] = [
  { name: "EFE Agencia", url: "https://www.efe.com/efe/espana/portada/rss.xml", domain: "efe.com", category: "World", lang: "es" },
  { name: "El País", url: "https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/portada", domain: "elpais.com", category: "World", lang: "es" },
  { name: "El País Internacional", url: "https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/section/internacional/portada", domain: "elpais.com", category: "World", lang: "es" },
  { name: "El Mundo", url: "https://e00-elmundo.uecdn.es/elmundo/rss/portada.xml", domain: "elmundo.es", category: "World", lang: "es" },
  { name: "BBC Mundo", url: "https://feeds.bbci.co.uk/mundo/rss.xml", domain: "bbc.com", category: "World", lang: "es" },
  { name: "DW Español", url: "https://rss.dw.com/rdf/rss-es-all", domain: "dw.com", category: "World", lang: "es" },
  { name: "France 24 ES", url: "https://www.france24.com/es/rss", domain: "france24.com", category: "World", lang: "es" },
  { name: "La Vanguardia", url: "https://www.lavanguardia.com/rss/home.xml", domain: "lavanguardia.com", category: "World", lang: "es" },
  { name: "Expansión", url: "https://e00-expansion.uecdn.es/rss/portada.xml", domain: "expansion.com", category: "Business", lang: "es" },
  { name: "El Confidencial", url: "https://rss.elconfidencial.com/espana/", domain: "elconfidencial.com", category: "Politics", lang: "es" },
  // Latin America
  { name: "LATAM Infobae", url: "https://www.infobae.com/feeds/rss/", domain: "infobae.com", category: "World", lang: "es" },
  { name: "Clarín", url: "https://www.clarin.com/rss/lo-ultimo/", domain: "clarin.com", category: "World", lang: "es" },
  { name: "La Nación AR", url: "https://www.lanacion.com.ar/arc/outboundfeeds/rss/", domain: "lanacion.com.ar", category: "World", lang: "es" },
  { name: "El Tiempo CO", url: "https://www.eltiempo.com/rss/portada.xml", domain: "eltiempo.com", category: "World", lang: "es" },
  // Sport
  { name: "Marca", url: "https://www.marca.com/rss/portada.html", domain: "marca.com", category: "Sports", lang: "es" },
  { name: "AS Fútbol", url: "https://as.com/rss/feeds/futbol.xml", domain: "as.com", category: "Sports", lang: "es" },
  // Science
  { name: "Muy Interesante", url: "https://www.muyinteresante.es/rss", domain: "muyinteresante.es", category: "Science", lang: "es" },
  // English wire: minimal
  { name: "Reuters", url: "https://feeds.reuters.com/reuters/topNews", domain: "reuters.com", category: "World", lang: "en" },
];

// ─── Portuguese Sources ────────────────────────────────────────────────────────
/**
 * Challenge: Portuguese spans two major markets with different conventions.
 * Brazil (Brazilian Portuguese) and Portugal (European Portuguese) are mutually
 * intelligible but distinct. We use sources from both equally.
 *
 * Brazilian anchors: G1 (Globo), Folha de S.Paulo, Agência Brasil (public wire).
 * Portuguese anchors: Público, Jornal de Notícias, RTP.
 * Cross-market: BBC Brasil, DW Português cover both.
 */
const PT_PRIMARY_SOURCES: RSSSource[] = [
  // Brazilian sources
  { name: "G1 Globo", url: "https://g1.globo.com/rss/g1/", domain: "g1.globo.com", category: "World", lang: "pt" },
  { name: "Folha de S.Paulo", url: "https://feeds.folha.uol.com.br/emcimadahora/rss091.xml", domain: "folha.uol.com.br", category: "World", lang: "pt" },
  { name: "Agência Brasil", url: "https://agenciabrasil.ebc.com.br/rss/ultimasnoticias/feed.xml", domain: "agenciabrasil.ebc.com.br", category: "World", lang: "pt" },
  { name: "UOL Notícias", url: "https://rss.uol.com.br/feed/noticias.xml", domain: "uol.com.br", category: "World", lang: "pt" },
  { name: "Estadão", url: "https://www.estadao.com.br/rss/ultimas.xml", domain: "estadao.com.br", category: "World", lang: "pt" },
  { name: "Veja", url: "https://veja.abril.com.br/feed/", domain: "veja.abril.com.br", category: "World", lang: "pt" },
  // Portuguese (Portugal) sources
  { name: "Público", url: "https://www.publico.pt/rss", domain: "publico.pt", category: "World", lang: "pt" },
  { name: "Jornal de Notícias", url: "https://www.jn.pt/rss/", domain: "jn.pt", category: "World", lang: "pt" },
  { name: "Expresso", url: "https://expresso.pt/rss", domain: "expresso.pt", category: "World", lang: "pt" },
  { name: "RTP Notícias", url: "https://www.rtp.pt/noticias/rss/todo-o-site", domain: "rtp.pt", category: "World", lang: "pt" },
  // Cross-market
  { name: "BBC Brasil", url: "https://feeds.bbci.co.uk/portuguese/rss.xml", domain: "bbc.com", category: "World", lang: "pt" },
  { name: "DW Português", url: "https://rss.dw.com/rdf/rss-por-all", domain: "dw.com", category: "World", lang: "pt" },
  { name: "France 24 PT", url: "https://www.france24.com/pt/rss", domain: "france24.com", category: "World", lang: "pt" },
  // Sport
  { name: "ESPN Brasil", url: "https://www.espnbrasil.com.br/rss/news", domain: "espnbrasil.com.br", category: "Sports", lang: "pt" },
  { name: "O Jogo", url: "https://www.ojogo.pt/rss/", domain: "ojogo.pt", category: "Sports", lang: "pt" },
  // English wire: minimal
  { name: "Reuters", url: "https://feeds.reuters.com/reuters/topNews", domain: "reuters.com", category: "World", lang: "en" },
];

// ─── Chinese Sources ───────────────────────────────────────────────────────────
/**
 * Challenge: Mainland Chinese outlets (Xinhua, People's Daily) publish RSS but
 * are state-controlled and not independent journalism. We exclusively use
 * international public broadcasters publishing in Chinese.
 *
 * BBC Chinese, DW Chinese, RFI Chinese, and Radio Free Asia all maintain
 * professionally managed RSS feeds and cover global news from an independent
 * editorial perspective. South China Morning Post (HK) provides regional depth.
 *
 * This means the Chinese edition has a shorter source list than other editions —
 * quality of source independence takes priority over quantity.
 */
const ZH_PRIMARY_SOURCES: RSSSource[] = [
  { name: "BBC 中文", url: "https://feeds.bbci.co.uk/zhongwen/simp/rss.xml", domain: "bbc.com", category: "World", lang: "zh" },
  { name: "DW 中文", url: "https://rss.dw.com/rdf/rss-chi-all", domain: "dw.com", category: "World", lang: "zh" },
  { name: "RFI 中文", url: "https://www.rfi.fr/cn/rss", domain: "rfi.fr", category: "World", lang: "zh" },
  { name: "自由亚洲电台", url: "https://www.rfa.org/mandarin/rss2.xml", domain: "rfa.org", category: "World", lang: "zh" },
  { name: "美国之音中文", url: "https://www.voachinese.com/api/zu-yqieis", domain: "voachinese.com", category: "World", lang: "zh" },
  { name: "南华早报", url: "https://www.scmp.com/rss/91/feed", domain: "scmp.com", category: "World", lang: "zh" },
  { name: "法广中文 科技", url: "https://www.rfi.fr/cn/经济/rss", domain: "rfi.fr", category: "Business", lang: "zh" },
  { name: "BBC 中文 科学", url: "https://feeds.bbci.co.uk/zhongwen/simp/science-environment/rss.xml", domain: "bbc.com", category: "Science", lang: "zh" },
  { name: "BBC 中文 体育", url: "https://feeds.bbci.co.uk/zhongwen/simp/sport/rss.xml", domain: "bbc.com", category: "Sports", lang: "zh" },
  // English wire for global depth the Chinese-language pool may miss
  { name: "Reuters", url: "https://feeds.reuters.com/reuters/topNews", domain: "reuters.com", category: "World", lang: "en" },
  { name: "Al Jazeera", url: "https://www.aljazeera.com/xml/rss/all.xml", domain: "aljazeera.com", category: "World", lang: "en" },
];

// ─── Russian Sources ───────────────────────────────────────────────────────────
/**
 * Challenge: Post-2022, several major independent Russian outlets have been
 * blocked in Russia or shut down. We use:
 *   - Meduza (Latvia) — largest independent Russian outlet post-2022
 *   - BBC Russian Service — stable, internationally maintained
 *   - DW Russian — professionally maintained, balanced
 *   - Radio Free Europe / Radio Liberty — independent, veteran Russian journalism
 *   - The Insider — investigative, based in Riga
 *
 * We do NOT include TASS, RIA Novosti, RT — state-controlled outlets.
 *
 * Note: Meduza's RSS may require CORS proxy in some environments. The
 * RSS fetcher handles failures silently — if Meduza fails, other sources cover.
 */
const RU_PRIMARY_SOURCES: RSSSource[] = [
  { name: "BBC Русская служба", url: "https://feeds.bbci.co.uk/russian/rss.xml", domain: "bbc.com", category: "World", lang: "ru" },
  { name: "DW Русская служба", url: "https://rss.dw.com/rdf/rss-rus-all", domain: "dw.com", category: "World", lang: "ru" },
  { name: "Радио Свобода", url: "https://www.svoboda.org/api/zu-kqeiiit", domain: "svoboda.org", category: "World", lang: "ru" },
  { name: "Meduza", url: "https://meduza.io/rss/all", domain: "meduza.io", category: "World", lang: "ru" },
  { name: "Медуза Новости", url: "https://meduza.io/rss/news", domain: "meduza.io", category: "World", lang: "ru" },
  { name: "RFI Русская", url: "https://www.rfi.fr/ru/rss", domain: "rfi.fr", category: "World", lang: "ru" },
  { name: "France 24 RU", url: "https://www.france24.com/ru/rss", domain: "france24.com", category: "World", lang: "ru" },
  { name: "Голос Америки", url: "https://www.golosameriki.com/api/zuy-yqeiit", domain: "golosameriki.com", category: "World", lang: "ru" },
  { name: "Euronews RU", url: "https://ru.euronews.com/rss?level=theme&name=news", domain: "euronews.com", category: "World", lang: "ru" },
  // English wire for global coverage
  { name: "Reuters", url: "https://feeds.reuters.com/reuters/topNews", domain: "reuters.com", category: "World", lang: "en" },
  { name: "Al Jazeera", url: "https://www.aljazeera.com/xml/rss/all.xml", domain: "aljazeera.com", category: "World", lang: "en" },
  { name: "BBC News", url: "https://feeds.bbci.co.uk/news/world/rss.xml", domain: "bbc.com", category: "World", lang: "en" },
];

// ─── Turkish Sources ──────────────────────────────────────────────────────────
/**
 * Turkish RSS source pool (v3.1.0).
 *
 * Challenge: Turkish media has a complex landscape — state broadcasters (TRT),
 * independent (Bianet, T24, Medyascope) and large groups (Hürriyet, Sabah).
 * Post-2016, many critical independent outlets faced legal pressure; some
 * have moved operations online-first with no traditional RSS.
 *
 * Strategy:
 *   - DW Türkçe and BBC Türkçe are international broadcasters: stable, reliable,
 *     CORS-friendly, independent editorial line.
 *   - Bianet is the leading independent investigative platform.
 *   - Cumhuriyet (oldest secular daily) publishes RSS regularly.
 *   - TRT Haber for the national broadcaster view of Turkish domestic news.
 *   - NTV for business/economy and breaking news.
 *
 * We keep 2 English wire sources at the end for global depth.
 */
const TR_PRIMARY_SOURCES: RSSSource[] = [
  { name: "BBC Türkçe", url: "https://feeds.bbci.co.uk/turkish/rss.xml", domain: "bbc.com", category: "World", lang: "tr" },
  { name: "DW Türkçe", url: "https://rss.dw.com/rdf/rss-tur-all", domain: "dw.com", category: "World", lang: "tr" },
  { name: "TRT Haber", url: "https://www.trthaber.com/sondakika.rss", domain: "trthaber.com", category: "World", lang: "tr" },
  { name: "Cumhuriyet", url: "https://www.cumhuriyet.com.tr/rss/son_dakika.xml", domain: "cumhuriyet.com.tr", category: "World", lang: "tr" },
  { name: "Bianet", url: "https://bianet.org/bianet.rss", domain: "bianet.org", category: "World", lang: "tr" },
  { name: "NTV Gündem", url: "https://www.ntv.com.tr/gundem.rss", domain: "ntv.com.tr", category: "World", lang: "tr" },
  { name: "NTV Ekonomi", url: "https://www.ntv.com.tr/ekonomi.rss", domain: "ntv.com.tr", category: "Business", lang: "tr" },
  { name: "Hürriyet Gündem", url: "https://www.hurriyet.com.tr/rss/gundem", domain: "hurriyet.com.tr", category: "World", lang: "tr" },
  { name: "Hürriyet Ekonomi", url: "https://www.hurriyet.com.tr/rss/ekonomi", domain: "hurriyet.com.tr", category: "Business", lang: "tr" },
  { name: "Sözcü Gündem", url: "https://www.sozcu.com.tr/rss/gundem.xml", domain: "sozcu.com.tr", category: "World", lang: "tr" },
  { name: "Sabah Teknoloji", url: "https://www.sabah.com.tr/rss/teknoloji.xml", domain: "sabah.com.tr", category: "Technology", lang: "tr" },
  { name: "Dünya Gazetesi", url: "https://www.dunya.com/rss", domain: "dunya.com", category: "Business", lang: "tr" },
  // English wire for global depth
  { name: "Reuters", url: "https://feeds.reuters.com/reuters/topNews", domain: "reuters.com", category: "World", lang: "en" },
  { name: "BBC News", url: "https://feeds.bbci.co.uk/news/world/rss.xml", domain: "bbc.com", category: "World", lang: "en" },
];

// ─── Italian Sources ───────────────────────────────────────────────────────────
/**
 * Italian RSS source pool (v3.1.0).
 *
 * Italian media has a healthy RSS ecosystem. Key sources:
 *   - ANSA: the Italian national wire service. Authoritative, fast, broadly used.
 *   - Corriere della Sera: largest Italian daily by circulation, reliable RSS.
 *   - La Repubblica: progressive broadsheet, strong political coverage.
 *   - Il Sole 24 Ore: Italian equivalent of FT — finance, economics, business.
 *   - RAI News: public broadcaster, national + international news.
 *   - La Stampa: historic Turin daily, strong EU/European coverage.
 *   - Gazzetta dello Sport: for the obligatory Serie A / calcio slot.
 *   - TGCom24: Mediaset news portal, popular, breaking news focus.
 *
 * Challenge: Some Corriere RSS feeds use Atom format. We set atomStyle: true
 * where needed to ensure the link extractor picks up href= rather than <link>.
 */
const IT_PRIMARY_SOURCES: RSSSource[] = [
  { name: "ANSA Ultime Notizie", url: "https://www.ansa.it/sito/notizie/topnews/topnews_rss.xml", domain: "ansa.it", category: "World", lang: "it" },
  { name: "ANSA Economia", url: "https://www.ansa.it/sito/notizie/economia/economia_rss.xml", domain: "ansa.it", category: "Business", lang: "it" },
  { name: "ANSA Tecnologia", url: "https://www.ansa.it/sito/notizie/tecnologia/tecnologia_rss.xml", domain: "ansa.it", category: "Technology", lang: "it" },
  { name: "Corriere della Sera", url: "https://xml2.corrieredellasera.it/rss/homepage.xml", domain: "corriere.it", category: "World", lang: "it" },
  { name: "La Repubblica", url: "https://www.repubblica.it/rss/homepage/rss2.0.xml", domain: "repubblica.it", category: "World", lang: "it" },
  { name: "Il Sole 24 Ore", url: "https://www.ilsole24ore.com/rss/mondo.xml", domain: "ilsole24ore.com", category: "Business", lang: "it" },
  { name: "Il Sole 24 Ore Economia", url: "https://www.ilsole24ore.com/rss/economia-e-finanza.xml", domain: "ilsole24ore.com", category: "Business", lang: "it" },
  { name: "RAI News", url: "https://www.rainews.it/dl/rainews/media/Feed-Tg3-a5e3f9f6-fc68-432c-ba9f-db3c1cf0f218.xml", domain: "rainews.it", category: "World", lang: "it" },
  { name: "La Stampa", url: "https://www.lastampa.it/rss.xml", domain: "lastampa.it", category: "World", lang: "it" },
  { name: "TGCom24", url: "https://www.tgcom24.mediaset.it/rss/cronaca.xml", domain: "tgcom24.mediaset.it", category: "World", lang: "it" },
  { name: "Gazzetta dello Sport", url: "https://www.gazzetta.it/rss/home.xml", domain: "gazzetta.it", category: "Sports", lang: "it" },
  { name: "DW Italiano", url: "https://rss.dw.com/rdf/rss-ita-all", domain: "dw.com", category: "World", lang: "it" },
  // English wire for global depth
  { name: "Reuters", url: "https://feeds.reuters.com/reuters/topNews", domain: "reuters.com", category: "World", lang: "en" },
  { name: "BBC News", url: "https://feeds.bbci.co.uk/news/world/rss.xml", domain: "bbc.com", category: "World", lang: "en" },
];

// ─── Edition Source Map ───────────────────────────────────────────────────────
/**
 * v3.1.0: 9 canonical edition IDs. Turkish (tr) and Italian (it) added.
 *
 * Each pool is designed to produce genuinely different stories:
 *   "en" — international English press: Reuters, BBC, NYT, Guardian, FT, Economist
 *   "fr" — French primary sources: RFI, France 24, Le Monde, AFP FR
 *   "de" — German primary sources: DW, Spiegel, FAZ, Süddeutsche, Zeit
 *   "es" — Spanish primary sources: EFE, El País, BBC Mundo, DW ES; plus LATAM
 *   "pt" — Portuguese sources: G1/Folha (Brazil) + Público/JN (Portugal) equally
 *   "zh" — Chinese-language international broadcasters: BBC Chinese, DW Chinese, RFI
 *   "ru" — Independent Russian-language sources: Meduza, BBC Russian, DW Russian
 *   "tr" — Turkish: DW Türkçe, BBC Türkçe, Bianet, Cumhuriyet, TRT Haber
 *   "it" — Italian: ANSA, Corriere della Sera, La Repubblica, Il Sole 24 Ore, RAI News
 */
export const EDITION_RSS_SOURCES: Record<string, RSSSource[]> = {
  "en": EN_GLOBAL_SOURCES,
  "fr": [...FR_PRIMARY_SOURCES],
  "de": [...DE_PRIMARY_SOURCES],
  "es": [...ES_PRIMARY_SOURCES],
  "pt": [...PT_PRIMARY_SOURCES],
  "zh": [...ZH_PRIMARY_SOURCES],
  "ru": [...RU_PRIMARY_SOURCES],
  "tr": [...TR_PRIMARY_SOURCES],
  "it": [...IT_PRIMARY_SOURCES],
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
 * Non-crossing [^<]* instead of greedy [\s\S]*? avoids ReDoS.
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

  for (const match of Array.from(safe.matchAll(/<item[^>]*>([\s\S]*?)<\/item>/gi))) {
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
 * Strips punctuation but preserves Unicode (handles Chinese, Russian, Arabic).
 * Dedup catches wire story duplicates across sources.
 */
function normTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\u00C0-\u024F\u0400-\u04FF\u4E00-\u9FFF\u3040-\u30FF ]/g, "")  // keep Latin, Cyrillic, CJK
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

// ─── Feed Fetcher ─────────────────────────────────────────────────────────────

async function fetchFeed(source: RSSSource): Promise<TrendStory[]> {
  try {
    const res = await fetch(source.url, {
      headers: {
        "User-Agent": "CupOfNews-Bot/3.0 (RSS; https://github.com/paulfxyz/cup-of-news)",
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
    return [];
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetch trending stories from the appropriate RSS sources for the given edition.
 *
 * v3.1.0: supports 9 edition IDs (en, fr, de, es, pt, zh, ru, tr, it).
 * Falls back to English sources if edition not recognised.
 *
 * Results are interleaved round-robin (1 per source per pass) to maximize
 * editorial diversity before truncation.
 */
export async function fetchTrendingStories(
  needed = 20,
  editionId = "en"
): Promise<TrendStory[]> {
  if (needed <= 0) return [];

  const sources = EDITION_RSS_SOURCES[editionId] ?? EDITION_RSS_SOURCES["en"];
  console.log(`📡 [${editionId}] Fetching from ${sources.length} RSS sources…`);

  const settled = await Promise.allSettled(sources.map(s => fetchFeed(s)));

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
