/**
 * @file shared/editions.ts
 * @author Paul Fleury <hello@paulfleury.com>
 * @version 3.2.4
 *
 * Cup of News — Edition Registry
 *
 * PHILOSOPHY: 1 edition = 1 language.
 *
 *   The original 8 editions (en-WORLD, en-US, en-CA, en-GB, fr-FR, fr-CA, de-DE, en-AU)
 *   were collapsed to 3 in v2.2.0. In v3.0.0, we expanded to 7 languages:
 *   English, French, German, Spanish, Portuguese, Chinese, Russian.
 *   In v3.2.0 we expand further to 9 languages, adding Turkish and Italian.
 *
 *   Each edition is genuinely different — different RSS sources, different topics,
 *   different cultural framing. Chinese readers care about different stories than
 *   Spanish readers. The AI generates natively in each language from primary-language
 *   source material, not by translating English wire copy.
 *
 * EDITION IDs (BCP 47 language tags):
 *   "en" — English (global)
 *   "fr" — Français
 *   "de" — Deutsch
 *   "es" — Español
 *   "pt" — Português
 *   "zh" — 中文 (Chinese)
 *   "ru" — Русский (Russian)
 *   "tr" — Türkçe (Turkish)
 *   "it" — Italiano (Italian)
 *
 * DEFAULT: English ("en")
 *
 * RSS SOURCE STRATEGY:
 *   Every non-English edition: native-language sources dominate (>80% of the pool).
 *   English wire services (Reuters, AP) appear in small quantities for global context only.
 *   This ensures stories feel like journalism from that culture, not translated English news.
 *
 * CHALLENGE — NON-LATIN SCRIPT RENDERING:
 *   Chinese and Russian editions output Unicode text. The AI (Gemini 2.5 Pro) handles
 *   both Simplified Chinese and Cyrillic natively. The app font stack includes
 *   system CJK fonts (STSong, PingFang) and system Cyrillic (Georgia, Arial).
 *   No additional font loading required.
 *
 * UI STRINGS:
 *   Every edition ships its own ui{} block so the reader interface is fully
 *   localised — no hardcoded English strings appear in any edition.
 */

// ─── Edition Type ──────────────────────────────────────────────────────────────

export interface Edition {
  /** BCP 47 language tag — used as DB key and localStorage key */
  id: "en" | "fr" | "de" | "es" | "pt" | "zh" | "ru" | "tr" | "it";

  /** Display name in that language */
  name: string;

  /** Flag emoji */
  flag: string;

  /** ISO 639-1 language code */
  language: "en" | "fr" | "de" | "es" | "pt" | "zh" | "ru";

  /** Language name in that language */
  languageName: string;

  /** Short description for the edition picker */
  description: string;

  /**
   * Language instruction injected as the FIRST rule in the AI system prompt.
   * Written in both English (model parses it) and the target language
   * (reinforcement that activates native-language generation pathways).
   */
  aiLanguageInstruction: string;

  /**
   * Regional and editorial focus.
   * For Spanish: Spanish/LATAM politics, LaLiga, regional economy.
   * For Portuguese: Portugal + Brazil — two very different news cycles.
   * For Chinese: Asia-Pacific, China tech, Belt & Road, 华语世界.
   * For Russian: Eastern Europe, CIS, energy, sanctions impact.
   */
  aiRegionalFocus: string;

  /**
   * Sport slot instruction — adapted per language/culture.
   */
  aiSportSlot: string;

  /**
   * Category names in the target language for the AI to use in JSON output.
   * The AI must use exactly these strings as "category" values.
   */
  categories: Record<string, string>;

  /**
   * Reader UI strings — fully localised interface labels.
   */
  ui: {
    readSources: string;
    closingThought: string;
    noDigestYet: string;
    noDigestSub: string;
    fallbackNotice: string;
    generateLink: string;
    prevStory: string;
    nextStory: string;
    allStories: string;
    of: string;
    refreshDigest: string;
    morningComplete: string;
  };
}

// ─── Edition Registry ─────────────────────────────────────────────────────────

export const EDITIONS: Edition[] = [
  // ── English ────────────────────────────────────────────────────────────────
  {
    id: "en",
    name: "English",
    flag: "🌐",
    language: "en",
    languageName: "English",
    description: "Global English edition",
    aiLanguageInstruction: "Write all titles, summaries and the closing quote in English.",
    aiRegionalFocus:
      "Provide genuinely global coverage. No single country or region should dominate. " +
      "Actively seek stories from underrepresented regions: Africa, South America, Southeast Asia, " +
      "Central Asia, Pacific Islands. English-language sources are your primary pool.",
    aiSportSlot: "any major international sport (football/soccer, tennis, F1, athletics, basketball, cricket, rugby)",
    categories: {
      Technology: "Technology", Science: "Science", Business: "Business",
      Politics: "Politics", World: "World", Culture: "Culture",
      Health: "Health", Environment: "Environment", Sports: "Sports", Other: "Other",
    },
    ui: {
      readSources: "Read sources",
      closingThought: "Today's Thought",
      noDigestYet: "No digest yet",
      noDigestSub: "Generate and publish a digest from the admin panel.",
      fallbackNotice: "not generated yet — showing latest available.",
      generateLink: "Generate →",
      prevStory: "Prev",
      nextStory: "Next",
      allStories: "All Stories",
      of: "of",
      refreshDigest: "New digest",
      morningComplete: "You've read today's digest",
    },
  },

  // ── Français ───────────────────────────────────────────────────────────────
  {
    id: "fr",
    name: "Français",
    flag: "🇫🇷",
    language: "fr",
    languageName: "Français",
    description: "Édition française — actualité mondiale",
    aiLanguageInstruction:
      "RÈGLE ABSOLUE : Écris TOUS les champs en FRANÇAIS. " +
      "This is a French-language edition. Every single output field must be in French: " +
      "title (titre), summary (résumé), closingQuote (citation), closingQuoteAuthor (attribution). " +
      "AUCUN mot en anglais dans les titres ou résumés.",
    aiRegionalFocus:
      "Prioritise stories relevant to French readers: politique française (Élysée, Assemblée, partis), " +
      "économie française (CAC 40, entreprises françaises, emploi), Union européenne, " +
      "culture française (cinéma, littérature, gastronomie), Afrique francophone. " +
      "Inclure au moins 8 histoires de portée internationale (hors France). " +
      "Sources en français en priorité: RFI, France 24, Le Monde, Le Figaro, AFP.",
    aiSportSlot:
      "football (Ligue 1, équipe de France, Champions League), rugby, tennis, cyclisme, Formule 1",
    categories: {
      Technology: "Technologie", Science: "Science", Business: "Économie",
      Politics: "Politique", World: "Monde", Culture: "Culture",
      Health: "Santé", Environment: "Environnement", Sports: "Sport", Other: "Autre",
    },
    ui: {
      readSources: "Lire les sources",
      closingThought: "Pensée du jour",
      noDigestYet: "Aucun digest disponible",
      noDigestSub: "Générez et publiez un digest depuis le panneau d'administration.",
      fallbackNotice: "pas encore généré — affichage de la dernière édition disponible.",
      generateLink: "Générer →",
      prevStory: "Préc.",
      nextStory: "Suiv.",
      allStories: "Toutes les actualités",
      of: "sur",
      refreshDigest: "Nouveau digest",
      morningComplete: "Vous avez lu le digest du jour",
    },
  },

  // ── Deutsch ────────────────────────────────────────────────────────────────
  {
    id: "de",
    name: "Deutsch",
    flag: "🇩🇪",
    language: "de",
    languageName: "Deutsch",
    description: "Deutsche Ausgabe — Weltnachrichten",
    aiLanguageInstruction:
      "ABSOLUTE REGEL: Schreibe ALLE Felder auf DEUTSCH. " +
      "This is a German-language edition. Every single output field must be in German: " +
      "title (Titel), summary (Zusammenfassung), closingQuote (Zitat), closingQuoteAuthor (Zuschreibung). " +
      "KEIN englisches Wort in Titeln oder Zusammenfassungen.",
    aiRegionalFocus:
      "Prioritisiere Nachrichten für deutschsprachige Leser: deutsche Politik (Bundestag, Bundesregierung, Parteien), " +
      "deutsche Wirtschaft (DAX, Mittelstand, Energiewende, Automobilindustrie), " +
      "EU-Politik (Deutschland als zentraler EU-Akteur), DACH-Region (Österreich, Schweiz). " +
      "Mindestens 8 internationale Geschichten einschließen (außerhalb DACH). " +
      "Deutsche Quellen bevorzugen: DW, Spiegel, FAZ, Süddeutsche, Zeit, Handelsblatt.",
    aiSportSlot:
      "Bundesliga, DFB-Nationalmannschaft, Formel 1, Tennis (ATP/WTA), Handball, Leichtathletik",
    categories: {
      Technology: "Technologie", Science: "Wissenschaft", Business: "Wirtschaft",
      Politics: "Politik", World: "Welt", Culture: "Kultur",
      Health: "Gesundheit", Environment: "Umwelt", Sports: "Sport", Other: "Sonstiges",
    },
    ui: {
      readSources: "Quellen lesen",
      closingThought: "Gedanke des Tages",
      noDigestYet: "Noch kein Digest",
      noDigestSub: "Erstellen Sie einen Digest über das Admin-Panel.",
      fallbackNotice: "noch nicht generiert — zeige neueste verfügbare Ausgabe.",
      generateLink: "Generieren →",
      prevStory: "Vorh.",
      nextStory: "Näch.",
      allStories: "Alle Nachrichten",
      of: "von",
      refreshDigest: "Neuer Digest",
      morningComplete: "Sie haben den heutigen Digest gelesen",
    },
  },

  // ── Español ────────────────────────────────────────────────────────────────
  {
    id: "es",
    name: "Español",
    flag: "🇪🇸",
    language: "es",
    languageName: "Español",
    description: "Edición en español — noticias del mundo",
    aiLanguageInstruction:
      "REGLA ABSOLUTA: Escribe TODOS los campos en ESPAÑOL. " +
      "This is a Spanish-language edition. Every single output field must be in Spanish: " +
      "title (título), summary (resumen), closingQuote (cita), closingQuoteAuthor (atribución). " +
      "NINGUNA palabra en inglés en títulos o resúmenes.",
    aiRegionalFocus:
      "Prioriza noticias relevantes para lectores hispanohablantes: política española (Congreso, partidos, monarquía), " +
      "economía española (IBEX 35, turismo, desempleo), América Latina (México, Argentina, Colombia, Chile, Venezuela), " +
      "Unión Europea desde perspectiva española, cultura hispana (cine, literatura, gastronomía). " +
      "Incluir al menos 8 historias de alcance internacional (fuera del mundo hispano). " +
      "Fuentes en español prioritarias: El País, EFE, El Mundo, BBC Mundo, Deutsche Welle ES.",
    aiSportSlot:
      "fútbol (LaLiga, selección española, Champions League, Copa América), tenis, Fórmula 1, ciclismo, baloncesto (ACB, NBA)",
    categories: {
      Technology: "Tecnología", Science: "Ciencia", Business: "Economía",
      Politics: "Política", World: "Mundo", Culture: "Cultura",
      Health: "Salud", Environment: "Medio Ambiente", Sports: "Deportes", Other: "Otros",
    },
    ui: {
      readSources: "Leer fuentes",
      closingThought: "Pensamiento del día",
      noDigestYet: "Sin digest todavía",
      noDigestSub: "Genera y publica un digest desde el panel de administración.",
      fallbackNotice: "aún no generado — mostrando la última edición disponible.",
      generateLink: "Generar →",
      prevStory: "Ant.",
      nextStory: "Sig.",
      allStories: "Todas las noticias",
      of: "de",
      refreshDigest: "Nuevo digest",
      morningComplete: "Has leído el digest de hoy",
    },
  },

  // ── Português ──────────────────────────────────────────────────────────────
  {
    id: "pt",
    name: "Português",
    flag: "🇧🇷",
    language: "pt",
    languageName: "Português",
    description: "Edição em português — notícias do mundo",
    aiLanguageInstruction:
      "REGRA ABSOLUTA: Escreva TODOS os campos em PORTUGUÊS. " +
      "This is a Portuguese-language edition. Every single output field must be in Portuguese: " +
      "title (título), summary (resumo), closingQuote (citação), closingQuoteAuthor (atribuição). " +
      "NENHUMA palavra em inglês em títulos ou resumos.",
    aiRegionalFocus:
      "Prioriza notícias relevantes para leitores de língua portuguesa: Brasil (política, economia, sociedade — maior país lusófono), " +
      "Portugal (política europeia, economia, relações lusófonas), CPLP (Angola, Moçambique, Cabo Verde, Timor-Leste), " +
      "América Latina, União Europeia. " +
      "Incluir pelo menos 8 histórias de alcance internacional. " +
      "Fontes em português: Folha de S.Paulo, G1, Globo, Público, Jornal de Notícias, Agência Brasil, BBC Brasil.",
    aiSportSlot:
      "futebol (Brasileirão, Liga Portugal, Seleção Brasileira, Seleção Portuguesa, Champions League), Fórmula 1 (pilotos brasileiros), tênis, vôlei",
    categories: {
      Technology: "Tecnologia", Science: "Ciência", Business: "Economia",
      Politics: "Política", World: "Mundo", Culture: "Cultura",
      Health: "Saúde", Environment: "Meio Ambiente", Sports: "Esportes", Other: "Outros",
    },
    ui: {
      readSources: "Ler fontes",
      closingThought: "Pensamento do dia",
      noDigestYet: "Sem digest ainda",
      noDigestSub: "Gere e publique um digest no painel de administração.",
      fallbackNotice: "ainda não gerado — exibindo a última edição disponível.",
      generateLink: "Gerar →",
      prevStory: "Ant.",
      nextStory: "Próx.",
      allStories: "Todas as notícias",
      of: "de",
      refreshDigest: "Novo digest",
      morningComplete: "Você leu o digest de hoje",
    },
  },

  // ── 中文 ───────────────────────────────────────────────────────────────────
  {
    id: "zh",
    name: "中文",
    flag: "🇨🇳",
    language: "zh",
    languageName: "中文",
    description: "中文版 — 全球新闻资讯",
    aiLanguageInstruction:
      "绝对规则：所有字段必须用简体中文书写。" +
      "This is a Chinese-language edition. Every single output field must be in Simplified Chinese: " +
      "title (标题), summary (摘要), closingQuote (结语引文), closingQuoteAuthor (引文出处). " +
      "标题和摘要中禁止出现英文单词。",
    aiRegionalFocus:
      "优先报道华语读者关心的新闻：中国国内政治与经济（中南海、人大、央行、A股），" +
      "亚太地区（日本、韩国、东南亚、澳大利亚），台海关系，中美关系，一带一路，" +
      "香港时事，科技创新（AI、半导体、电动车），国际多边关系。" +
      "至少包含8条超出亚洲范围的国际新闻。" +
      "优先中文信源：BBC中文、Deutsche Welle中文、法广中文、端传媒、South China Morning Post。",
    aiSportSlot:
      "足球（中超、FIFA世界杯预选赛、欧洲五大联赛）、乒乓球、羽毛球、NBA、网球、冬奥项目",
    categories: {
      Technology: "科技", Science: "科学", Business: "经济",
      Politics: "政治", World: "国际", Culture: "文化",
      Health: "健康", Environment: "环境", Sports: "体育", Other: "其他",
    },
    ui: {
      readSources: "阅读来源",
      closingThought: "今日寄语",
      noDigestYet: "暂无摘要",
      noDigestSub: "请从管理面板生成并发布摘要。",
      fallbackNotice: "尚未生成 — 显示最新可用版本。",
      generateLink: "生成 →",
      prevStory: "上一条",
      nextStory: "下一条",
      allStories: "所有报道",
      of: "/",
      refreshDigest: "新摘要",
      morningComplete: "您已阅读完今日摘要",
    },
  },

  // ── Русский ────────────────────────────────────────────────────────────────
  {
    id: "ru",
    name: "Русский",
    flag: "🇷🇺",
    language: "ru",
    languageName: "Русский",
    description: "Выпуск на русском — новости мира",
    aiLanguageInstruction:
      "АБСОЛЮТНОЕ ПРАВИЛО: Пиши ВСЕ поля на РУССКОМ ЯЗЫКЕ. " +
      "This is a Russian-language edition. Every single output field must be in Russian: " +
      "title (заголовок), summary (резюме), closingQuote (цитата), closingQuoteAuthor (источник). " +
      "НИ ОДНОГО английского слова в заголовках и резюме.",
    aiRegionalFocus:
      "Приоритет — новости, важные для русскоязычных читателей: " +
      "международная политика (ООН, G20, НАТО, ЕС), " +
      "Восточная Европа и постсоветское пространство (СНГ, Беларусь, Кавказ, Центральная Азия), " +
      "мировая экономика (энергетика, санкции, торговля), наука и технологии, культура. " +
      "Охват должен быть глобальным: Азия, Африка, Латинская Америка, Ближний Восток. " +
      "Минимум 10 международных новостей вне постсоветского пространства. " +
      "Источники: BBC Русская служба, Deutsche Welle Русская служба, Радио Свобода, The Insider, Meduza.",
    aiSportSlot:
      "футбол (лиги мира, сборные), теннис (Большой шлем), хоккей (НХЛ, КХЛ), биатлон, лёгкая атлетика",
    categories: {
      Technology: "Технологии", Science: "Наука", Business: "Экономика",
      Politics: "Политика", World: "Мир", Culture: "Культура",
      Health: "Здоровье", Environment: "Экология", Sports: "Спорт", Other: "Другое",
    },
    ui: {
      readSources: "Читать источники",
      closingThought: "Мысль дня",
      noDigestYet: "Дайджест ещё не создан",
      noDigestSub: "Создайте и опубликуйте дайджест из панели администратора.",
      fallbackNotice: "ещё не создан — показывается последний доступный выпуск.",
      generateLink: "Создать →",
      prevStory: "Назад",
      nextStory: "Вперёд",
      allStories: "Все новости",
      of: "из",
      refreshDigest: "Новый дайджест",
      morningComplete: "Вы прочитали дайджест на сегодня",
    },
  },

  // ── Türkçe ───────────────────────────────────────────────────────────────────────
  {
    id: "tr",
    name: "Türkçe",
    flag: "🇹🇷",
    language: "tr",
    languageName: "Türkçe",
    description: "Türkçe baskı — dünyadan haberler",
    aiLanguageInstruction:
      "KESİN KURAL: TÜM alanları TÜRKÇE olarak yaz. " +
      "This is a Turkish-language edition. Every single output field must be in Turkish: " +
      "title (başlık), summary (özet), closingQuote (kapanış alıntısı), closingQuoteAuthor (alıntı kaynağı). " +
      "Başlıklarda veya özetlerde İNGILIZCE kelime KULLANILAMAZ.",
    aiRegionalFocus:
      "Türk okuyucular için öncelikli haberler: Türkiye iç siyaseti (TBMM, hükümet, siyasi partiler), " +
      "Türkiye ekonomisi (TCMB, dolar kuru, enflasyon, piyasalar), " +
      "Bölgesel siyaset (Orta Doğu, Kafkasya, Balkanlar, NATO), " +
      "Avrupa Birliği ve Türkiye-AB ilişkileri, " +
      "Türkiye teknoloji ve girişim ekosistemi. " +
      "En az 8 uluslararası haber dahil edilmeli (Türkiye dışından). " +
      "Öncelikli Kaynaklar: BBC Türkçe, DW Türkçe, Bianet, Cumhuriyet, TRT Haber.",
    aiSportSlot:
      "futbol (Süper Lig, Milli Takım, UEFA Şampiyonlar Ligi), basketbol (BSL, NBA), tenis, F1",
    categories: {
      Technology: "Teknoloji", Science: "Bilim", Business: "Ekonomi",
      Politics: "Siyaset", World: "Dünya", Culture: "Kültür",
      Health: "Sağlık", Environment: "Çevre", Sports: "Spor", Other: "Diğer",
    },
    ui: {
      readSources: "Kaynaklara bak",
      closingThought: "Günün düşüncesi",
      noDigestYet: "Henüz özet yok",
      noDigestSub: "Yönetim panelinden bir özet oluşturun ve yayınlayın.",
      fallbackNotice: "henüz oluşturulmadı — mevcut son baskı gösteriliyor.",
      generateLink: "Oluştur →",
      prevStory: "Önceki",
      nextStory: "Sonraki",
      allStories: "Tüm haberler",
      of: "/",
      refreshDigest: "Yeni özet",
      morningComplete: "Bugünkü özeti okudunuz",
    },
  },

  // ── Italiano ─────────────────────────────────────────────────────────────────────
  {
    id: "it",
    name: "Italiano",
    flag: "🇮🇹",
    language: "it",
    languageName: "Italiano",
    description: "Edizione italiana — notizie dal mondo",
    aiLanguageInstruction:
      "REGOLA ASSOLUTA: Scrivi TUTTI i campi in ITALIANO. " +
      "This is an Italian-language edition. Every single output field must be in Italian: " +
      "title (titolo), summary (sintesi), closingQuote (citazione), closingQuoteAuthor (attribuzione). " +
      "NESSUNA parola in inglese in titoli o sintesi.",
    aiRegionalFocus:
      "Priorità alle notizie rilevanti per i lettori italiani: politica italiana (Parlamento, Governo, Quirinale, partiti), " +
      "economia italiana (FTSE MIB, PMI, disoccupazione, turismo), " +
      "Unione Europea dalla prospettiva italiana (Italia come quarta economia UE), " +
      "cultura italiana (cinema, letteratura, gastronomia, moda, design), " +
      "scienza e tecnologia (ricerca universitaria italiana, startup italiane). " +
      "Includere almeno 8 notizie di portata internazionale (fuori dall'Italia). " +
      "Fonti prioritarie: ANSA, Corriere della Sera, La Repubblica, Il Sole 24 Ore, RAI News, La Stampa.",
    aiSportSlot:
      "calcio (Serie A, Nazionale italiana, Champions League), Formula 1 (piloti Ferrari), tennis, ciclismo (Giro d’Italia), sci alpino",
    categories: {
      Technology: "Tecnologia", Science: "Scienza", Business: "Economia",
      Politics: "Politica", World: "Mondo", Culture: "Cultura",
      Health: "Salute", Environment: "Ambiente", Sports: "Sport", Other: "Altro",
    },
    ui: {
      readSources: "Leggi le fonti",
      closingThought: "Pensiero del giorno",
      noDigestYet: "Nessuna rassegna ancora",
      noDigestSub: "Genera e pubblica una rassegna dal pannello di amministrazione.",
      fallbackNotice: "non ancora generata — viene mostrata l’ultima edizione disponibile.",
      generateLink: "Genera →",
      prevStory: "Prec.",
      nextStory: "Succ.",
      allStories: "Tutte le notizie",
      of: "di",
      refreshDigest: "Nuova rassegna",
      morningComplete: "Hai letto la rassegna di oggi",
    },
  },
];

/** Look up edition by ID — falls back to English */
export function getEdition(id: string): Edition {
  return EDITIONS.find(e => e.id === id) ?? EDITIONS[0];
}

/** The default edition shown on first load */
export const DEFAULT_EDITION = EDITIONS[0]; // English
