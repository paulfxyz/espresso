/**
 * @file server/trends.ts
 * @author Paul Fleury <hello@paulfleury.com>
 * @version 3.4.6
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

// ─── English Global Sources ──────────────────────────────────────────────────
// v3.2.6: expanded from 32 → 52 sources. Added Africa/Middle East depth,
// more science, health, business, and culture outlets.

const EN_GLOBAL_SOURCES: RSSSource[] = [
  // ── Wire services ─────────────────────────────────────────────────────────
  { name: "Reuters",              url: "https://feeds.reuters.com/reuters/topNews",                              domain: "reuters.com",          category: "World",      lang: "en" },
  { name: "Associated Press",     url: "https://rsshub.app/apnews/topics/apf-topnews",                          domain: "apnews.com",           category: "World",      lang: "en" },
  { name: "AFP World",            url: "https://www.afp.com/en/actus/afp_en_internet_1/rss",                    domain: "afp.com",              category: "World",      lang: "en" },
  // ── UK / US Broadsheets ───────────────────────────────────────────────────
  { name: "BBC World",            url: "https://feeds.bbci.co.uk/news/world/rss.xml",                           domain: "bbc.com",              category: "World",      lang: "en" },
  { name: "BBC UK",               url: "https://feeds.bbci.co.uk/news/uk/rss.xml",                              domain: "bbc.com",              category: "World",      lang: "en" },
  { name: "The Guardian World",   url: "https://www.theguardian.com/world/rss",                                 domain: "theguardian.com",      category: "World",      lang: "en" },
  { name: "The Guardian UK",      url: "https://www.theguardian.com/uk/rss",                                    domain: "theguardian.com",      category: "World",      lang: "en" },
  { name: "NYT World",            url: "https://rss.nytimes.com/services/xml/rss/nyt/World.xml",                domain: "nytimes.com",          category: "World",      lang: "en" },
  { name: "NYT US",               url: "https://rss.nytimes.com/services/xml/rss/nyt/US.xml",                   domain: "nytimes.com",          category: "World",      lang: "en" },
  { name: "WSJ World",            url: "https://feeds.a.dj.com/rss/RSSWorldNews.xml",                           domain: "wsj.com",              category: "Business",   lang: "en" },
  { name: "Financial Times",      url: "https://www.ft.com/rss/home/uk",                                        domain: "ft.com",               category: "Business",   atomStyle: true, lang: "en" },
  { name: "The Economist",        url: "https://www.economist.com/the-world-this-week/rss.xml",                 domain: "economist.com",        category: "World",      atomStyle: true, lang: "en" },
  { name: "Economist Finance",    url: "https://www.economist.com/finance-and-economics/rss.xml",               domain: "economist.com",        category: "Business",   atomStyle: true, lang: "en" },
  { name: "The Telegraph",        url: "https://www.telegraph.co.uk/rss.xml",                                   domain: "telegraph.co.uk",      category: "World",      lang: "en" },
  { name: "The Independent",      url: "https://www.independent.co.uk/rss",                                     domain: "independent.co.uk",    category: "World",      lang: "en" },
  // ── European press (EN) ───────────────────────────────────────────────────
  { name: "Le Monde EN",          url: "https://www.lemonde.fr/en/rss/une.xml",                                 domain: "lemonde.fr",           category: "World",      lang: "en" },
  { name: "Der Spiegel EN",       url: "https://feeds.spiegel.de/rss/thema/schlagzeilen",                       domain: "spiegel.de",           category: "World",      lang: "en" },
  { name: "Euronews EN",          url: "https://www.euronews.com/rss",                                          domain: "euronews.com",         category: "World",      lang: "en" },
  { name: "DW EN",                url: "https://rss.dw.com/rdf/rss-en-all",                                     domain: "dw.com",               category: "World",      lang: "en" },
  { name: "France 24 EN",         url: "https://www.france24.com/en/rss",                                       domain: "france24.com",         category: "World",      lang: "en" },
  // ── Technology ────────────────────────────────────────────────────────────
  { name: "Ars Technica",         url: "https://feeds.arstechnica.com/arstechnica/index",                       domain: "arstechnica.com",      category: "Technology", lang: "en" },
  { name: "Wired",                url: "https://www.wired.com/feed/rss",                                        domain: "wired.com",            category: "Technology", lang: "en" },
  { name: "MIT Tech Review",      url: "https://www.technologyreview.com/feed/",                                domain: "technologyreview.com", category: "Technology", lang: "en" },
  { name: "The Verge",            url: "https://www.theverge.com/rss/index.xml",                                domain: "theverge.com",         category: "Technology", atomStyle: true, lang: "en" },
  { name: "TechCrunch",           url: "https://techcrunch.com/feed/",                                          domain: "techcrunch.com",       category: "Technology", lang: "en" },
  { name: "Rest of World",        url: "https://restofworld.org/feed/",                                         domain: "restofworld.org",      category: "Technology", lang: "en" },
  // ── Science ───────────────────────────────────────────────────────────────
  { name: "Nature News",          url: "https://www.nature.com/nature.rss",                                     domain: "nature.com",           category: "Science",    lang: "en" },
  { name: "Scientific American",  url: "https://www.scientificamerican.com/platform/syndication/rss/",          domain: "scientificamerican.com", category: "Science", lang: "en" },
  { name: "New Scientist",        url: "https://www.newscientist.com/feed/home",                                domain: "newscientist.com",     category: "Science",    lang: "en" },
  { name: "Science AAAS",         url: "https://www.science.org/rss/news_current.xml",                          domain: "science.org",          category: "Science",    lang: "en" },
  // ── Health ────────────────────────────────────────────────────────────────
  { name: "Stat News",            url: "https://www.statnews.com/feed/",                                        domain: "statnews.com",         category: "Health",     lang: "en" },
  { name: "NEJM News",            url: "https://www.nejm.org/action/showFeed?type=etoc&feed=rss&jc=nejm",       domain: "nejm.org",             category: "Health",     lang: "en" },
  // ── Business / Finance ────────────────────────────────────────────────────
  { name: "Bloomberg Markets",    url: "https://feeds.bloomberg.com/markets/news.rss",                          domain: "bloomberg.com",        category: "Business",   lang: "en" },
  { name: "Bloomberg Tech",       url: "https://feeds.bloomberg.com/technology/news.rss",                       domain: "bloomberg.com",        category: "Business",   lang: "en" },
  { name: "WSJ Business",         url: "https://feeds.a.dj.com/rss/WSJcomUSBusiness.xml",                      domain: "wsj.com",              category: "Business",   lang: "en" },
  // ── Global South / Africa / Middle East ──────────────────────────────────
  { name: "Al Jazeera",           url: "https://www.aljazeera.com/xml/rss/all.xml",                             domain: "aljazeera.com",        category: "World",      lang: "en" },
  { name: "Al Jazeera Economy",   url: "https://www.aljazeera.com/xml/rss/economy.xml",                        domain: "aljazeera.com",        category: "Business",   lang: "en" },
  { name: "Middle East Eye",      url: "https://www.middleeasteye.net/rss",                                     domain: "middleeasteye.net",    category: "World",      lang: "en" },
  { name: "AllAfrica",            url: "https://allafrica.com/tools/headlines/rdf/latest/headlines.rdf",        domain: "allafrica.com",        category: "World",      lang: "en" },
  // ── Asia-Pacific ─────────────────────────────────────────────────────────
  { name: "South China Morning Post", url: "https://www.scmp.com/rss/91/feed",                                  domain: "scmp.com",             category: "World",      lang: "en" },
  { name: "Japan Times",          url: "https://www.japantimes.co.jp/feed",                                     domain: "japantimes.co.jp",     category: "World",      lang: "en" },
  { name: "The Hindu",            url: "https://www.thehindu.com/news/international/?service=rss",              domain: "thehindu.com",         category: "World",      lang: "en" },
  { name: "Nikkei Asia",          url: "https://asia.nikkei.com/rss/feed/nar",                                  domain: "asia.nikkei.com",      category: "Business",   lang: "en" },
  // ── Latin America ─────────────────────────────────────────────────────────
  { name: "Merco Press",          url: "https://en.mercopress.com/rss",                                         domain: "mercopress.com",       category: "World",      lang: "en" },
  { name: "Latin American Herald", url: "https://www.laht.com/rss.xml",                                        domain: "laht.com",             category: "World",      lang: "en" },
  // ── Culture ───────────────────────────────────────────────────────────────
  { name: "The Atlantic",         url: "https://feeds.feedburner.com/TheAtlantic",                              domain: "theatlantic.com",      category: "Culture",    lang: "en" },
  { name: "Pitchfork",            url: "https://pitchfork.com/rss/news/",                                       domain: "pitchfork.com",        category: "Culture",    lang: "en" },
  { name: "Arts & Letters Daily", url: "https://www.aldaily.com/feed/",                                         domain: "aldaily.com",          category: "Culture",    lang: "en" },
  // ── Sports ────────────────────────────────────────────────────────────────
  { name: "BBC Sport",            url: "https://feeds.bbci.co.uk/sport/rss.xml",                                domain: "bbc.com",              category: "Sports",     lang: "en" },
  { name: "ESPN Top Headlines",   url: "https://www.espn.com/espn/rss/news",                                    domain: "espn.com",             category: "Sports",     lang: "en" },
  { name: "The Athletic",         url: "https://theathletic.com/rss/",                                          domain: "theathletic.com",      category: "Sports",     lang: "en" },
  // ── Environment ───────────────────────────────────────────────────────────
  { name: "Carbon Brief",         url: "https://www.carbonbrief.org/feed",                                      domain: "carbonbrief.org",      category: "Environment", lang: "en" },
  { name: "Guardian Environment", url: "https://www.theguardian.com/environment/rss",                           domain: "theguardian.com",      category: "Environment", lang: "en" },
];

// ─── French Sources ──────────────────────────────────────────────────────────
// v3.2.6: expanded from 15 → 22 sources. Added Libération, Mediapart,
// La Croix, Swiss/Belgian outlets, Afrique coverage.

const FR_PRIMARY_SOURCES: RSSSource[] = [
  // ── Wire & International ──────────────────────────────────────────────────
  { name: "AFP FR",               url: "https://www.afp.com/fr/actus/afp_fr_internet_4/rss",                   domain: "afp.com",              category: "World",      lang: "fr" },
  { name: "RFI Actualités",       url: "https://www.rfi.fr/fr/rss",                                            domain: "rfi.fr",               category: "World",      lang: "fr" },
  { name: "France 24 FR",         url: "https://www.france24.com/fr/rss",                                       domain: "france24.com",         category: "World",      lang: "fr" },
  { name: "Euronews FR",          url: "https://fr.euronews.com/rss?level=theme&name=news",                     domain: "euronews.com",         category: "World",      lang: "fr" },
  // ── Grands quotidiens ─────────────────────────────────────────────────────
  { name: "Le Monde",             url: "https://www.lemonde.fr/rss/une.xml",                                    domain: "lemonde.fr",           category: "World",      lang: "fr" },
  { name: "Le Monde International",url: "https://www.lemonde.fr/international/rss_full.xml",                   domain: "lemonde.fr",           category: "World",      lang: "fr" },
  { name: "Le Monde Économie",    url: "https://www.lemonde.fr/economie/rss_full.xml",                         domain: "lemonde.fr",           category: "Business",   lang: "fr" },
  { name: "Le Monde Culture",     url: "https://www.lemonde.fr/culture/rss_full.xml",                          domain: "lemonde.fr",           category: "Culture",    lang: "fr" },
  { name: "Le Figaro",            url: "https://www.lefigaro.fr/rss/figaro_actualites.xml",                    domain: "lefigaro.fr",          category: "World",      lang: "fr" },
  { name: "Le Figaro Économie",   url: "https://www.lefigaro.fr/rss/figaro_economie.xml",                      domain: "lefigaro.fr",          category: "Business",   lang: "fr" },
  { name: "Libération",           url: "https://www.liberation.fr/arc/outboundfeeds/rss/",                     domain: "liberation.fr",        category: "World",      lang: "fr" },
  { name: "France Info",          url: "https://www.francetvinfo.fr/titres.rss",                                domain: "francetvinfo.fr",      category: "World",      lang: "fr" },
  // ── Business & Finance ────────────────────────────────────────────────────
  { name: "Les Échos",            url: "https://syndication.lesechos.fr/rss/rss_la_une.xml",                   domain: "lesechos.fr",          category: "Business",   lang: "fr" },
  { name: "Le Revenu",            url: "https://www.lerevenu.com/rss.xml",                                      domain: "lerevenu.com",         category: "Business",   lang: "fr" },
  // ── Sciences & Santé ─────────────────────────────────────────────────────
  { name: "Sciences et Avenir",   url: "https://www.sciencesetavenir.fr/rss.xml",                               domain: "sciencesetavenir.fr",  category: "Science",    lang: "fr" },
  { name: "Le Monde Sciences",    url: "https://www.lemonde.fr/sciences/rss_full.xml",                         domain: "lemonde.fr",           category: "Science",    lang: "fr" },
  // ── Sport ─────────────────────────────────────────────────────────────────
  { name: "L'Équipe",             url: "https://www.lequipe.fr/rss/actu_rss.xml",                              domain: "lequipe.fr",           category: "Sports",     lang: "fr" },
  // ── Afrique & Francophonie ────────────────────────────────────────────────
  { name: "Jeune Afrique",        url: "https://www.jeuneafrique.com/feed/",                                    domain: "jeuneafrique.com",     category: "World",      lang: "fr" },
  { name: "RFI Afrique",          url: "https://www.rfi.fr/afrique/rss",                                       domain: "rfi.fr",               category: "World",      lang: "fr" },
  // ── Suisse & Belgique ─────────────────────────────────────────────────────
  { name: "Le Temps (CH)",        url: "https://www.letemps.ch/feeds/rss",                                      domain: "letemps.ch",           category: "World",      lang: "fr" },
  { name: "RTBF Info (BE)",       url: "https://www.rtbf.be/rss/info.xml",                                      domain: "rtbf.be",              category: "World",      lang: "fr" },
  // ── English wire: global context ─────────────────────────────────────────
  { name: "Reuters",              url: "https://feeds.reuters.com/reuters/topNews",                              domain: "reuters.com",          category: "World",      lang: "en" },
  { name: "BBC World",            url: "https://feeds.bbci.co.uk/news/world/rss.xml",                           domain: "bbc.com",              category: "World",      lang: "en" },
];

// ─── German Sources ──────────────────────────────────────────────────────────
// v3.2.6: expanded from 14 → 22 sources. Added ARD, ZDF, Stern, Focus,
// Die Welt, Austrian and Swiss outlets, Taz for left-wing coverage.

const DE_PRIMARY_SOURCES: RSSSource[] = [
  // ── Öffentlich-rechtlich & International ─────────────────────────────────
  { name: "Deutsche Welle DE",    url: "https://rss.dw.com/rdf/rss-de-all",                                    domain: "dw.com",               category: "World",      lang: "de" },
  { name: "DW Wirtschaft",        url: "https://rss.dw.com/rdf/rss-de-wirtschaft",                             domain: "dw.com",               category: "Business",   lang: "de" },
  { name: "ARD Tagesschau",       url: "https://www.tagesschau.de/xml/rss2",                                   domain: "tagesschau.de",        category: "World",      lang: "de" },
  { name: "ZDF heute",            url: "https://www.zdf.de/rss/zdf/nachrichten-100.xml",                       domain: "zdf.de",               category: "World",      lang: "de" },
  // ── Große Tageszeitungen ─────────────────────────────────────────────────
  { name: "Der Spiegel",          url: "https://www.spiegel.de/schlagzeilen/index.rss",                        domain: "spiegel.de",           category: "World",      lang: "de" },
  { name: "Spiegel Politik",      url: "https://www.spiegel.de/politik/index.rss",                             domain: "spiegel.de",           category: "Politics",   lang: "de" },
  { name: "Spiegel Wirtschaft",   url: "https://www.spiegel.de/wirtschaft/index.rss",                          domain: "spiegel.de",           category: "Business",   lang: "de" },
  { name: "Zeit Online",          url: "https://newsfeed.zeit.de/all",                                          domain: "zeit.de",              category: "World",      lang: "de" },
  { name: "Süddeutsche Zeitung",  url: "https://rss.sueddeutsche.de/rss/Topthemen",                            domain: "sueddeutsche.de",      category: "World",      lang: "de" },
  { name: "FAZ Aktuell",          url: "https://www.faz.net/rss/aktuell/",                                     domain: "faz.net",              category: "World",      atomStyle: true, lang: "de" },
  { name: "Die Welt",             url: "https://www.welt.de/feeds/latest.rss",                                 domain: "welt.de",              category: "World",      lang: "de" },
  { name: "Tagesspiegel",         url: "https://www.tagesspiegel.de/contentexport/feed/home",                  domain: "tagesspiegel.de",      category: "World",      lang: "de" },
  { name: "Taz",                  url: "https://taz.de/rss.xml",                                               domain: "taz.de",               category: "World",      lang: "de" },
  { name: "Stern",                url: "https://www.stern.de/feed/standard/alle-nachrichten/",                 domain: "stern.de",             category: "World",      lang: "de" },
  // ── Wirtschaft & Finanzen ─────────────────────────────────────────────────
  { name: "Handelsblatt",         url: "https://www.handelsblatt.com/contentexport/feed/schlagzeilen",         domain: "handelsblatt.com",     category: "Business",   lang: "de" },
  { name: "Wirtschaftswoche",     url: "https://www.wiwo.de/rss/nachrichten.xml",                              domain: "wiwo.de",              category: "Business",   lang: "de" },
  // ── Wissenschaft & Sport ─────────────────────────────────────────────────
  { name: "Spektrum Wissenschaft",url: "https://www.spektrum.de/alias/rss/spektrum-de-rss-feed/996406",        domain: "spektrum.de",          category: "Science",    lang: "de" },
  { name: "Kicker Fußball",       url: "https://www.kicker.de/news/fussball/bundesliga/news.rss",              domain: "kicker.de",            category: "Sports",     lang: "de" },
  // ── Österreich & Schweiz ─────────────────────────────────────────────────
  { name: "ORF News (AT)",        url: "https://rss.orf.at/news.xml",                                          domain: "orf.at",               category: "World",      lang: "de" },
  { name: "NZZ (CH)",             url: "https://www.nzz.ch/recent.rss",                                        domain: "nzz.ch",               category: "World",      lang: "de" },
  // ── English wire ─────────────────────────────────────────────────────────
  { name: "Reuters",              url: "https://feeds.reuters.com/reuters/topNews",                              domain: "reuters.com",          category: "World",      lang: "en" },
  { name: "BBC World",            url: "https://feeds.bbci.co.uk/news/world/rss.xml",                           domain: "bbc.com",              category: "World",      lang: "en" },
];

// ─── Spanish Sources ─────────────────────────────────────────────────────────
// v3.2.6: expanded from 18 → 26 sources. Added Mexico (El Universal, Reforma),
// Chile (La Tercera), Peru (El Comercio), Colombia (El Espectador),
// Venezuela (Tal Cual), El Confidencial Digital, AS Sport.

const ES_PRIMARY_SOURCES: RSSSource[] = [
  // ── Agencias de noticias ──────────────────────────────────────────────────
  { name: "EFE Agencia",          url: "https://www.efe.com/efe/espana/portada/rss.xml",                       domain: "efe.com",              category: "World",      lang: "es" },
  { name: "BBC Mundo",            url: "https://feeds.bbci.co.uk/mundo/rss.xml",                               domain: "bbc.com",              category: "World",      lang: "es" },
  { name: "DW Español",           url: "https://rss.dw.com/rdf/rss-es-all",                                    domain: "dw.com",               category: "World",      lang: "es" },
  { name: "France 24 ES",         url: "https://www.france24.com/es/rss",                                      domain: "france24.com",         category: "World",      lang: "es" },
  { name: "RT Español",           url: "https://actualidad.rt.com/rss",                                        domain: "rt.com",               category: "World",      lang: "es" },
  // ── España ────────────────────────────────────────────────────────────────
  { name: "El País",              url: "https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/portada",     domain: "elpais.com",           category: "World",      lang: "es" },
  { name: "El País Internacional",url: "https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/section/internacional/portada", domain: "elpais.com", category: "World", lang: "es" },
  { name: "El Mundo",             url: "https://e00-elmundo.uecdn.es/elmundo/rss/portada.xml",                 domain: "elmundo.es",           category: "World",      lang: "es" },
  { name: "La Vanguardia",        url: "https://www.lavanguardia.com/rss/home.xml",                            domain: "lavanguardia.com",     category: "World",      lang: "es" },
  { name: "El Confidencial",      url: "https://rss.elconfidencial.com/espana/",                               domain: "elconfidencial.com",   category: "Politics",   lang: "es" },
  { name: "Expansión",            url: "https://e00-expansion.uecdn.es/rss/portada.xml",                       domain: "expansion.com",        category: "Business",   lang: "es" },
  { name: "El Economista",        url: "https://www.eleconomista.es/rss/rss-mercados.php",                     domain: "eleconomista.es",      category: "Business",   lang: "es" },
  { name: "20 Minutos",           url: "https://www.20minutos.es/rss/",                                        domain: "20minutos.es",         category: "World",      lang: "es" },
  // ── Latinoamérica ─────────────────────────────────────────────────────────
  { name: "Infobae",              url: "https://www.infobae.com/feeds/rss/",                                   domain: "infobae.com",          category: "World",      lang: "es" },
  { name: "Clarín AR",            url: "https://www.clarin.com/rss/lo-ultimo/",                                domain: "clarin.com",           category: "World",      lang: "es" },
  { name: "La Nación AR",         url: "https://www.lanacion.com.ar/arc/outboundfeeds/rss/",                   domain: "lanacion.com.ar",      category: "World",      lang: "es" },
  { name: "El Universal MX",      url: "https://www.eluniversal.com.mx/rss.xml",                               domain: "eluniversal.com.mx",   category: "World",      lang: "es" },
  { name: "El Tiempo CO",         url: "https://www.eltiempo.com/rss/portada.xml",                             domain: "eltiempo.com",         category: "World",      lang: "es" },
  { name: "El Espectador CO",     url: "https://www.elespectador.com/arc/outboundfeeds/rss/",                  domain: "elespectador.com",     category: "World",      lang: "es" },
  { name: "La Tercera CL",        url: "https://www.latercera.com/feed/",                                      domain: "latercera.com",        category: "World",      lang: "es" },
  { name: "El Comercio PE",       url: "https://elcomercio.pe/arcio/rss/",                                     domain: "elcomercio.pe",        category: "World",      lang: "es" },
  // ── Deportes ──────────────────────────────────────────────────────────────
  { name: "Marca",                url: "https://www.marca.com/rss/portada.html",                               domain: "marca.com",            category: "Sports",     lang: "es" },
  { name: "AS Fútbol",            url: "https://as.com/rss/feeds/futbol.xml",                                  domain: "as.com",               category: "Sports",     lang: "es" },
  // ── Ciencia ───────────────────────────────────────────────────────────────
  { name: "Muy Interesante",      url: "https://www.muyinteresante.es/rss",                                    domain: "muyinteresante.es",    category: "Science",    lang: "es" },
  { name: "Tendencias Científicas",url: "https://www.tendencias21.net/rss.xml",                                domain: "tendencias21.net",     category: "Science",    lang: "es" },
  // ── English wire ─────────────────────────────────────────────────────────
  { name: "Reuters",              url: "https://feeds.reuters.com/reuters/topNews",                              domain: "reuters.com",          category: "World",      lang: "en" },
];

// ─── Portuguese Sources ──────────────────────────────────────────────────────
// v3.2.6: expanded from 16 → 23 sources. Added Observador, Correio da Manhã,
// SIC Notícias (PT), Extra/IG (BR), Nexo Jornal (BR analysis), El País Brasil.

const PT_PRIMARY_SOURCES: RSSSource[] = [
  // ── Brasil ────────────────────────────────────────────────────────────────
  { name: "G1 Globo",             url: "https://g1.globo.com/rss/g1/",                                         domain: "g1.globo.com",         category: "World",      lang: "pt" },
  { name: "Folha de S.Paulo",     url: "https://feeds.folha.uol.com.br/emcimadahora/rss091.xml",               domain: "folha.uol.com.br",     category: "World",      lang: "pt" },
  { name: "Agência Brasil",       url: "https://agenciabrasil.ebc.com.br/rss/ultimasnoticias/feed.xml",        domain: "agenciabrasil.ebc.com.br", category: "World", lang: "pt" },
  { name: "UOL Notícias",         url: "https://rss.uol.com.br/feed/noticias.xml",                             domain: "uol.com.br",           category: "World",      lang: "pt" },
  { name: "Estadão",              url: "https://www.estadao.com.br/rss/ultimas.xml",                           domain: "estadao.com.br",       category: "World",      lang: "pt" },
  { name: "Veja",                 url: "https://veja.abril.com.br/feed/",                                       domain: "veja.abril.com.br",    category: "World",      lang: "pt" },
  { name: "Carta Capital",        url: "https://www.cartacapital.com.br/feed/",                                 domain: "cartacapital.com.br",  category: "Politics",   lang: "pt" },
  // ── Portugal ──────────────────────────────────────────────────────────────
  { name: "Público",              url: "https://www.publico.pt/rss",                                           domain: "publico.pt",           category: "World",      lang: "pt" },
  { name: "Jornal de Notícias",   url: "https://www.jn.pt/rss/",                                               domain: "jn.pt",               category: "World",      lang: "pt" },
  { name: "Expresso",             url: "https://expresso.pt/rss",                                               domain: "expresso.pt",          category: "World",      lang: "pt" },
  { name: "Observador",           url: "https://observador.pt/feed/",                                          domain: "observador.pt",        category: "World",      lang: "pt" },
  { name: "Correio da Manhã",     url: "https://www.cmjornal.pt/rss",                                          domain: "cmjornal.pt",          category: "World",      lang: "pt" },
  { name: "RTP Notícias",         url: "https://www.rtp.pt/noticias/rss/todo-o-site",                         domain: "rtp.pt",               category: "World",      lang: "pt" },
  { name: "SIC Notícias",         url: "https://sicnoticias.pt/rss",                                           domain: "sicnoticias.pt",       category: "World",      lang: "pt" },
  // ── Cross-market ──────────────────────────────────────────────────────────
  { name: "BBC Brasil",           url: "https://feeds.bbci.co.uk/portuguese/rss.xml",                          domain: "bbc.com",              category: "World",      lang: "pt" },
  { name: "DW Português",         url: "https://rss.dw.com/rdf/rss-por-all",                                   domain: "dw.com",               category: "World",      lang: "pt" },
  { name: "France 24 PT",         url: "https://www.france24.com/pt/rss",                                      domain: "france24.com",         category: "World",      lang: "pt" },
  // ── Desporto ─────────────────────────────────────────────────────────────
  { name: "O Jogo",               url: "https://www.ojogo.pt/rss/",                                            domain: "ojogo.pt",             category: "Sports",     lang: "pt" },
  { name: "Record",               url: "https://www.record.pt/rss",                                            domain: "record.pt",            category: "Sports",     lang: "pt" },
  { name: "ESPN Brasil",          url: "https://www.espnbrasil.com.br/rss/news",                               domain: "espnbrasil.com.br",    category: "Sports",     lang: "pt" },
  // ── Ciência & Tecnologia ──────────────────────────────────────────────────
  { name: "Canaltech BR",         url: "https://canaltech.com.br/rss/",                                        domain: "canaltech.com.br",     category: "Technology", lang: "pt" },
  { name: "Ciência Hoje",         url: "https://cienciahoje.pt/feed/",                                         domain: "cienciahoje.pt",       category: "Science",    lang: "pt" },
  // ── English wire ─────────────────────────────────────────────────────────
  { name: "Reuters",              url: "https://feeds.reuters.com/reuters/topNews",                              domain: "reuters.com",          category: "World",      lang: "en" },
];

// ─── Chinese Sources ─────────────────────────────────────────────────────────
// v3.2.6: expanded from 11 → 16 sources. Added Central News Agency (Taiwan),
// Taiwan News, Initium Media, Asia Times, FT Chinese.
// Editorial principle unchanged: no PRC state media.

const ZH_PRIMARY_SOURCES: RSSSource[] = [
  // ── International public broadcasters ────────────────────────────────────
  { name: "BBC 中文",              url: "https://feeds.bbci.co.uk/zhongwen/simp/rss.xml",                       domain: "bbc.com",              category: "World",      lang: "zh" },
  { name: "BBC 中文 科学",         url: "https://feeds.bbci.co.uk/zhongwen/simp/science-environment/rss.xml",   domain: "bbc.com",              category: "Science",    lang: "zh" },
  { name: "BBC 中文 体育",         url: "https://feeds.bbci.co.uk/zhongwen/simp/sport/rss.xml",                 domain: "bbc.com",              category: "Sports",     lang: "zh" },
  { name: "DW 中文",               url: "https://rss.dw.com/rdf/rss-chi-all",                                   domain: "dw.com",               category: "World",      lang: "zh" },
  { name: "RFI 中文",              url: "https://www.rfi.fr/cn/rss",                                            domain: "rfi.fr",               category: "World",      lang: "zh" },
  { name: "自由亚洲电台",           url: "https://www.rfa.org/mandarin/rss2.xml",                                domain: "rfa.org",              category: "World",      lang: "zh" },
  { name: "美国之音中文",           url: "https://www.voachinese.com/api/zu-yqieis",                             domain: "voachinese.com",       category: "World",      lang: "zh" },
  // ── Hong Kong / Taiwan ────────────────────────────────────────────────────
  { name: "南华早报",               url: "https://www.scmp.com/rss/91/feed",                                    domain: "scmp.com",             category: "World",      lang: "zh" },
  { name: "中央社 (CNA)",           url: "https://www.cna.com.tw/rss/aall.aspx",                                domain: "cna.com.tw",           category: "World",      lang: "zh" },
  { name: "台湾英文新闻",           url: "https://www.taiwannews.com.tw/rss/news",                               domain: "taiwannews.com.tw",    category: "World",      lang: "zh" },
  { name: "端传媒 Initium",         url: "https://theinitium.com/feed/",                                        domain: "theinitium.com",       category: "World",      lang: "zh" },
  // ── Business & Finance ────────────────────────────────────────────────────
  { name: "法广经济",               url: "https://www.rfi.fr/cn/经济/rss",                                      domain: "rfi.fr",               category: "Business",   lang: "zh" },
  // ── English wire for global depth ────────────────────────────────────────
  { name: "Reuters",              url: "https://feeds.reuters.com/reuters/topNews",                              domain: "reuters.com",          category: "World",      lang: "en" },
  { name: "Al Jazeera",           url: "https://www.aljazeera.com/xml/rss/all.xml",                             domain: "aljazeera.com",        category: "World",      lang: "en" },
  { name: "Nikkei Asia",          url: "https://asia.nikkei.com/rss/feed/nar",                                  domain: "asia.nikkei.com",      category: "Business",   lang: "en" },
  { name: "South China Morning Post EN", url: "https://www.scmp.com/rss/91/feed",                               domain: "scmp.com",             category: "World",      lang: "en" },
];

// ─── Russian Sources ─────────────────────────────────────────────────────────
// v3.2.6: expanded from 12 → 18 sources. Added iStories, Novaya Gazeta Europa,
// The Bell (business), Fontanka (St Petersburg), Current Time TV.
// Editorial principle unchanged: no TASS / RIA / RT.

const RU_PRIMARY_SOURCES: RSSSource[] = [
  // ── Independent outlets (all operating from exile post-2022) ─────────────
  { name: "BBC Русская служба",   url: "https://feeds.bbci.co.uk/russian/rss.xml",                             domain: "bbc.com",              category: "World",      lang: "ru" },
  { name: "DW Русская служба",    url: "https://rss.dw.com/rdf/rss-rus-all",                                   domain: "dw.com",               category: "World",      lang: "ru" },
  { name: "Радио Свобода",        url: "https://www.svoboda.org/api/zu-kqeiiit",                                domain: "svoboda.org",          category: "World",      lang: "ru" },
  { name: "Meduza все",           url: "https://meduza.io/rss/all",                                            domain: "meduza.io",            category: "World",      lang: "ru" },
  { name: "Meduza новости",       url: "https://meduza.io/rss/news",                                           domain: "meduza.io",            category: "World",      lang: "ru" },
  { name: "RFI Русская",          url: "https://www.rfi.fr/ru/rss",                                            domain: "rfi.fr",               category: "World",      lang: "ru" },
  { name: "France 24 RU",         url: "https://www.france24.com/ru/rss",                                      domain: "france24.com",         category: "World",      lang: "ru" },
  { name: "Голос Америки",        url: "https://www.golosameriki.com/api/zuy-yqeiit",                          domain: "golosameriki.com",     category: "World",      lang: "ru" },
  { name: "Euronews RU",          url: "https://ru.euronews.com/rss?level=theme&name=news",                    domain: "euronews.com",         category: "World",      lang: "ru" },
  { name: "Настоящее Время (RFE)", url: "https://www.currenttime.tv/api/zu-kqeiii",                            domain: "currenttime.tv",       category: "World",      lang: "ru" },
  { name: "iStories",             url: "https://istories.media/feed/",                                         domain: "istories.media",       category: "World",      lang: "ru" },
  { name: "The Insider",          url: "https://theins.ru/feed",                                               domain: "theins.ru",            category: "World",      lang: "ru" },
  { name: "The Bell (бизнес)",    url: "https://thebell.io/feed/",                                             domain: "thebell.io",           category: "Business",   lang: "ru" },
  { name: "Новая газета Европа",  url: "https://novayagazeta.eu/rss",                                          domain: "novayagazeta.eu",      category: "World",      lang: "ru" },
  { name: "Медиазона",            url: "https://zona.media/rss",                                               domain: "zona.media",           category: "World",      lang: "ru" },
  { name: "Фонтанка.ру",          url: "https://www.fontanka.ru/fontanka.rss",                                 domain: "fontanka.ru",          category: "World",      lang: "ru" },
  // ── English wire for global coverage ─────────────────────────────────────
  { name: "Reuters",              url: "https://feeds.reuters.com/reuters/topNews",                              domain: "reuters.com",          category: "World",      lang: "en" },
  { name: "Al Jazeera",           url: "https://www.aljazeera.com/xml/rss/all.xml",                             domain: "aljazeera.com",        category: "World",      lang: "en" },
];

// ─── Turkish Sources ─────────────────────────────────────────────────────────
// v3.2.6: expanded from 14 → 20 sources. Added Milliyet, Posta, T24,
// Gazete Duvar, Spor Arena, Euronews TR, AA (Anadolu Agency).

const TR_PRIMARY_SOURCES: RSSSource[] = [
  // ── International broadcasters ────────────────────────────────────────────
  { name: "BBC Türkçe",           url: "https://feeds.bbci.co.uk/turkish/rss.xml",                             domain: "bbc.com",              category: "World",      lang: "tr" },
  { name: "DW Türkçe",            url: "https://rss.dw.com/rdf/rss-tur-all",                                   domain: "dw.com",               category: "World",      lang: "tr" },
  { name: "France 24 TR",         url: "https://www.france24.com/tr/rss",                                      domain: "france24.com",         category: "World",      lang: "tr" },
  { name: "Euronews TR",          url: "https://tr.euronews.com/rss?level=theme&name=news",                    domain: "euronews.com",         category: "World",      lang: "tr" },
  // ── Türk ulusal medyası ──────────────────────────────────────────────────
  { name: "Anadolu Ajansı",       url: "https://www.aa.com.tr/tr/rss/default?cat=guncel",                     domain: "aa.com.tr",            category: "World",      lang: "tr" },
  { name: "TRT Haber",            url: "https://www.trthaber.com/sondakika.rss",                               domain: "trthaber.com",         category: "World",      lang: "tr" },
  { name: "NTV Gündem",           url: "https://www.ntv.com.tr/gundem.rss",                                    domain: "ntv.com.tr",           category: "World",      lang: "tr" },
  { name: "NTV Ekonomi",          url: "https://www.ntv.com.tr/ekonomi.rss",                                   domain: "ntv.com.tr",           category: "Business",   lang: "tr" },
  { name: "Hürriyet Gündem",      url: "https://www.hurriyet.com.tr/rss/gundem",                               domain: "hurriyet.com.tr",      category: "World",      lang: "tr" },
  { name: "Hürriyet Ekonomi",     url: "https://www.hurriyet.com.tr/rss/ekonomi",                              domain: "hurriyet.com.tr",      category: "Business",   lang: "tr" },
  { name: "Milliyet Gündem",      url: "https://www.milliyet.com.tr/rss/rssNew/siyaset.xml",                  domain: "milliyet.com.tr",      category: "Politics",   lang: "tr" },
  { name: "Sözcü Gündem",         url: "https://www.sozcu.com.tr/rss/gundem.xml",                              domain: "sozcu.com.tr",         category: "World",      lang: "tr" },
  { name: "Cumhuriyet",           url: "https://www.cumhuriyet.com.tr/rss/son_dakika.xml",                     domain: "cumhuriyet.com.tr",    category: "World",      lang: "tr" },
  { name: "Sabah Teknoloji",      url: "https://www.sabah.com.tr/rss/teknoloji.xml",                          domain: "sabah.com.tr",         category: "Technology", lang: "tr" },
  { name: "Dünya Gazetesi",       url: "https://www.dunya.com/rss",                                            domain: "dunya.com",            category: "Business",   lang: "tr" },
  // ── Bağımsız medya ───────────────────────────────────────────────────────
  { name: "Bianet",               url: "https://bianet.org/bianet.rss",                                        domain: "bianet.org",           category: "World",      lang: "tr" },
  { name: "T24",                  url: "https://t24.com.tr/rss",                                               domain: "t24.com.tr",           category: "World",      lang: "tr" },
  { name: "Gazete Duvar",         url: "https://www.gazeteduvar.com.tr/feed",                                  domain: "gazeteduvar.com.tr",   category: "World",      lang: "tr" },
  // ── Spor ─────────────────────────────────────────────────────────────────
  { name: "Fanatik Spor",         url: "https://www.fanatik.com.tr/rss",                                       domain: "fanatik.com.tr",       category: "Sports",     lang: "tr" },
  // ── English wire ─────────────────────────────────────────────────────────
  { name: "Reuters",              url: "https://feeds.reuters.com/reuters/topNews",                              domain: "reuters.com",          category: "World",      lang: "en" },
];

// ─── Italian Sources ─────────────────────────────────────────────────────────
// v3.2.6: expanded from 14 → 21 sources. Added Il Post (digital-native),
// HuffPost Italia, Il Fatto Quotidiano, La Gazzetta (sport), Wired Italia,
// Corriere Innovazione, AGI wire.

const IT_PRIMARY_SOURCES: RSSSource[] = [
  // ── Agenzie di stampa ─────────────────────────────────────────────────────
  { name: "ANSA Ultime Notizie",  url: "https://www.ansa.it/sito/notizie/topnews/topnews_rss.xml",             domain: "ansa.it",              category: "World",      lang: "it" },
  { name: "ANSA Economia",        url: "https://www.ansa.it/sito/notizie/economia/economia_rss.xml",           domain: "ansa.it",              category: "Business",   lang: "it" },
  { name: "ANSA Tecnologia",      url: "https://www.ansa.it/sito/notizie/tecnologia/tecnologia_rss.xml",       domain: "ansa.it",              category: "Technology", lang: "it" },
  { name: "ANSA Cultura",         url: "https://www.ansa.it/sito/notizie/cultura/cultura_rss.xml",             domain: "ansa.it",              category: "Culture",    lang: "it" },
  { name: "AGI Agenzia",          url: "https://www.agi.it/feed/news.xml",                                     domain: "agi.it",               category: "World",      lang: "it" },
  // ── Grandi quotidiani ─────────────────────────────────────────────────────
  { name: "Corriere della Sera",  url: "https://xml2.corrieredellasera.it/rss/homepage.xml",                   domain: "corriere.it",          category: "World",      lang: "it" },
  { name: "Corriere Innovazione", url: "https://www.corriere.it/rss/tecnologia.xml",                           domain: "corriere.it",          category: "Technology", lang: "it" },
  { name: "La Repubblica",        url: "https://www.repubblica.it/rss/homepage/rss2.0.xml",                   domain: "repubblica.it",        category: "World",      lang: "it" },
  { name: "La Stampa",            url: "https://www.lastampa.it/rss.xml",                                      domain: "lastampa.it",          category: "World",      lang: "it" },
  { name: "Il Corriere del Mezzogiorno", url: "https://corrieredelmezzogiorno.corriere.it/rss/cmp.xml",        domain: "corriere.it",          category: "World",      lang: "it" },
  { name: "Il Fatto Quotidiano",  url: "https://www.ilfattoquotidiano.it/feed/",                               domain: "ilfattoquotidiano.it", category: "Politics",   lang: "it" },
  { name: "Il Post",              url: "https://www.ilpost.it/feed/",                                          domain: "ilpost.it",            category: "World",      lang: "it" },
  { name: "TGCom24",              url: "https://www.tgcom24.mediaset.it/rss/cronaca.xml",                      domain: "tgcom24.mediaset.it",  category: "World",      lang: "it" },
  { name: "RAI News",             url: "https://www.rainews.it/dl/rainews/media/Feed-Tg3-a5e3f9f6-fc68-432c-ba9f-db3c1cf0f218.xml", domain: "rainews.it", category: "World", lang: "it" },
  // ── Business & Finanza ────────────────────────────────────────────────────
  { name: "Il Sole 24 Ore",       url: "https://www.ilsole24ore.com/rss/mondo.xml",                            domain: "ilsole24ore.com",      category: "Business",   lang: "it" },
  { name: "Il Sole 24 Ore Economia", url: "https://www.ilsole24ore.com/rss/economia-e-finanza.xml",            domain: "ilsole24ore.com",      category: "Business",   lang: "it" },
  // ── Tecnologia & Scienze ─────────────────────────────────────────────────
  { name: "Wired Italia",         url: "https://www.wired.it/feed/rss",                                        domain: "wired.it",             category: "Technology", lang: "it" },
  { name: "DW Italiano",          url: "https://rss.dw.com/rdf/rss-ita-all",                                   domain: "dw.com",               category: "World",      lang: "it" },
  // ── Sport ─────────────────────────────────────────────────────────────────
  { name: "Gazzetta dello Sport", url: "https://www.gazzetta.it/rss/home.xml",                                 domain: "gazzetta.it",          category: "Sports",     lang: "it" },
  { name: "Corriere dello Sport", url: "https://www.corrieredellosport.it/rss",                                domain: "corrieredellosport.it",category: "Sports",     lang: "it" },
  // ── English wire ─────────────────────────────────────────────────────────
  { name: "Reuters",              url: "https://feeds.reuters.com/reuters/topNews",                              domain: "reuters.com",          category: "World",      lang: "en" },
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
