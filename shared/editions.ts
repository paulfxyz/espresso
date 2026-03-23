/**
 * @file shared/editions.ts
 * @author Paul Fleury <hello@paulfleury.com>
 * @version 2.1.1
 *
 * Cup of News — Edition Registry
 *
 * Context:
 *   v2.0.0 introduces the Edition System: 8 geographic/linguistic editions
 *   that each generate their own independent digest in the appropriate language,
 *   sourced from regionally-relevant RSS feeds.
 *
 * Design decisions:
 *
 *   WHY SEPARATE DIGESTS PER EDITION (not just UI translation):
 *     A French edition isn't just the World edition translated. The editorial
 *     selection changes: Le Monde leads over NYT, French politics matters more,
 *     sport means football (Ligue 1, Champions League) not NFL. The AI must
 *     receive French-language sources and instructions in French to produce
 *     genuinely French editorial content — not a translated Anglo-Saxon digest.
 *
 *   WHY THE EDITION KEY INCLUDES LANGUAGE (e.g. "fr-FR" not just "FR"):
 *     Canada gets two editions (English and French). The same ISO country code
 *     can't differentiate them. Using BCP 47 locale tags (language-REGION)
 *     gives a clean namespace that maps directly to i18n conventions and
 *     correctly handles multilingual countries.
 *
 *   WHY STORE EDITION IN THE DIGEST ROW:
 *     The digests table previously used (date) as the unique key, meaning only
 *     one digest per day was possible. For v2.0.0 the unique key becomes
 *     (date, edition), allowing up to 8 independent digests per day.
 *     This is a backwards-compatible migration: existing rows get edition = "en-WORLD".
 *
 *   LANGUAGE IN AI PROMPTS:
 *     The system prompt for French/German editions instructs the AI to write
 *     titles and summaries in the target language. The category names are also
 *     translated so the UI can display them correctly. The diversity mandate
 *     is adapted: French edition emphasises European/francophone coverage;
 *     German edition emphasises DACH and EU institutional news.
 *
 *   RSS SOURCE STRATEGY PER EDITION:
 *     Each edition has a "primary" source list (regionally-focused, correct language)
 *     and falls back to global wire services (Reuters, AP, AFP) which cover all regions.
 *     French feeds use Le Monde, Le Figaro, Libération, RFI, Europe 1.
 *     German feeds use FAZ, Der Spiegel, Süddeutsche Zeitung, DW, Tagesspiegel.
 *     Both also retain international English-language sources for global context —
 *     the AI is instructed to write summaries in the edition language regardless of
 *     the source language.
 *
 *   CHALLENGE: French/German RSS feeds are harder to get than English ones.
 *     Many major French newspapers don't publish full public RSS. We use:
 *     - Le Monde: has a good public RSS
 *     - Le Figaro: public RSS available (politique, international)
 *     - RFI (Radio France Internationale): excellent free RSS, very reliable
 *     - France 24: solid French-language RSS
 *     - Europe 1: available
 *     German:
 *     - Der Spiegel: German-language feed available
 *     - Süddeutsche Zeitung: RSS available
 *     - FAZ: has RSS
 *     - Deutsche Welle: excellent multi-topic feeds, very reliable
 *     - Zeit Online: good RSS
 *
 *   This file is shared/ so both server (pipeline, trends) and client (UI, localStorage)
 *   can import the edition definitions without duplication.
 */

// ─── Edition Type ──────────────────────────────────────────────────────────────

export interface Edition {
  /** BCP 47 locale tag — used as DB key and localStorage key */
  id: string;

  /** Display name in the UI */
  name: string;

  /** ISO 3166-1 alpha-2 country code for flag display */
  country: string;

  /** Flag emoji — shown in the header selector */
  flag: string;

  /** BCP 47 language code — drives AI prompt language */
  language: "en" | "fr" | "de";

  /** Human-readable language name in that language */
  languageName: string;

  /** Continent/region — used for editorial diversity mandate */
  region: "americas" | "europe" | "global" | "oceania";

  /** Short description shown in the edition picker */
  description: string;

  /**
   * UI strings for the reader interface in this edition's language.
   * Used to localise navigation, labels, and CTAs in DigestView.
   * Kept minimal — only strings visible in the reader, not the admin panel.
   */
  ui: {
    readSources: string;      // "Read sources" button
    showingSince: string;     // "x of y"
    closingThought: string;   // "Today's Thought"
    noDigestYet: string;      // empty state headline
    noDigestSub: string;      // empty state subtext
    fallbackNotice: string;   // when showing cross-edition fallback
    generateLink: string;     // "Generate →" in fallback banner
    prevStory: string;        // "Prev" nav button
    nextStory: string;        // "Next" nav button
    allStories: string;       // grid overlay title
    closingQuoteOf: string;   // "Closing Thought"
  };

  /**
   * Language instruction injected into the AI system prompt.
   * Should be in BOTH English (so the model understands) AND the target language
   * (to reinforce the instruction).
   */
  aiLanguageInstruction: string;

  /**
   * Regional editorial focus — added to the AI prompt to tune source priority
   * and story selection towards this edition's readership.
   */
  aiRegionalFocus: string;

  /**
   * Category names in the target language.
   * English editions use the default English categories.
   * Used for display in the reader UI.
   */
  categories: Record<string, string>;
}

// ─── Edition Registry ─────────────────────────────────────────────────────────

export const EDITIONS: Edition[] = [
  {
    id: "en-WORLD",
    name: "World",
    country: "WORLD",
    flag: "🌐",
    language: "en",
    languageName: "English",
    region: "global",
    description: "Global English edition — 20 stories from around the world",
    aiLanguageInstruction: "Write all titles and summaries in English.",
    aiRegionalFocus: "Provide balanced global coverage. No single region should dominate.",
    ui: {
      readSources: "Read sources",
      showingSince: "of",
      closingThought: "Today's Thought",
      noDigestYet: "No digest yet",
      noDigestSub: "Generate and publish a digest from the admin panel to start reading.",
      fallbackNotice: "not generated yet — showing latest available edition.",
      generateLink: "Generate →",
      prevStory: "Prev",
      nextStory: "Next",
      allStories: "All Stories",
      closingQuoteOf: "Closing Thought",
    },
    categories: {
      Technology: "Technology", Science: "Science", Business: "Business",
      Politics: "Politics", World: "World", Culture: "Culture",
      Health: "Health", Environment: "Environment", Sports: "Sports", Other: "Other",
    },
  },
  {
    id: "en-US",
    name: "United States",
    country: "US",
    flag: "🇺🇸",
    language: "en",
    languageName: "English",
    region: "americas",
    description: "US English — American perspective with global context",
    aiLanguageInstruction: "Write all titles and summaries in American English.",
    aiRegionalFocus:
      "Prioritise stories with US relevance: American politics, US economy, Silicon Valley tech, US sports (NFL, NBA, MLB, MLS), US foreign policy. Still maintain global breadth — at least 8 stories from outside the US.",
    ui: {
      readSources: "Read sources",
      showingSince: "of",
      closingThought: "Today's Thought",
      noDigestYet: "No digest yet",
      noDigestSub: "Generate and publish a digest from the admin panel to start reading.",
      fallbackNotice: "not generated yet — showing latest available edition.",
      generateLink: "Generate →",
      prevStory: "Prev",
      nextStory: "Next",
      allStories: "All Stories",
      closingQuoteOf: "Closing Thought",
    },
    categories: {
      Technology: "Technology", Science: "Science", Business: "Business",
      Politics: "Politics", World: "World", Culture: "Culture",
      Health: "Health", Environment: "Environment", Sports: "Sports", Other: "Other",
    },
  },
  {
    id: "en-CA",
    name: "Canada (English)",
    country: "CA",
    flag: "🇨🇦",
    language: "en",
    languageName: "English",
    region: "americas",
    description: "Canadian English — Canadian focus with global coverage",
    aiLanguageInstruction: "Write all titles and summaries in Canadian English.",
    aiRegionalFocus:
      "Prioritise stories relevant to Canada: Canadian politics, the Canadian economy (energy, housing, trade with US), Canadian sports (NHL, CFL, Canadian Olympic athletes), Canadian-US relations. Include strong global coverage — at least 8 non-North-American stories.",
    ui: {
      readSources: "Read sources",
      showingSince: "of",
      closingThought: "Today's Thought",
      noDigestYet: "No digest yet",
      noDigestSub: "Generate and publish a digest from the admin panel to start reading.",
      fallbackNotice: "not generated yet — showing latest available edition.",
      generateLink: "Generate →",
      prevStory: "Prev",
      nextStory: "Next",
      allStories: "All Stories",
      closingQuoteOf: "Closing Thought",
    },
    categories: {
      Technology: "Technology", Science: "Science", Business: "Business",
      Politics: "Politics", World: "World", Culture: "Culture",
      Health: "Health", Environment: "Environment", Sports: "Sports", Other: "Other",
    },
  },
  {
    id: "fr-CA",
    name: "Canada (Français)",
    country: "CA",
    flag: "🇨🇦",
    language: "fr",
    languageName: "Français",
    region: "americas",
    description: "Édition canadienne française — actualités en français",
    aiLanguageInstruction:
      "IMPORTANT: Write ALL titles and summaries in FRENCH (français). This is a French-Canadian edition. Use Quebec French conventions where appropriate. All text must be in French — no English titles or summaries.",
    aiRegionalFocus:
      "Prioritise stories relevant to French Canada: Quebec politics and culture, Canadian-French relations, francophone Canada, the Canadian economy and US-Canada trade, hockey (NHL) as the primary sport. Include strong international francophone coverage (France, Belgium, Senegal, Morocco). At least 6 stories from outside North America.",
    ui: {
      readSources: "Lire les sources",
      showingSince: "sur",
      closingThought: "Pensée du jour",
      noDigestYet: "Aucun digest disponible",
      noDigestSub: "Générez et publiez un digest depuis le panneau d'administration pour commencer à lire.",
      fallbackNotice: "pas encore généré — affichage de la dernière édition disponible.",
      generateLink: "Générer →",
      prevStory: "Préc.",
      nextStory: "Suiv.",
      allStories: "Toutes les actualités",
      closingQuoteOf: "Pensée de clôture",
    },
    categories: {
      Technology: "Technologie", Science: "Science", Business: "Économie",
      Politics: "Politique", World: "Monde", Culture: "Culture",
      Health: "Santé", Environment: "Environnement", Sports: "Sport", Other: "Autre",
    },
  },
  {
    id: "en-GB",
    name: "United Kingdom",
    country: "GB",
    flag: "🇬🇧",
    language: "en",
    languageName: "English",
    region: "europe",
    description: "UK English — British perspective with world coverage",
    aiLanguageInstruction: "Write all titles and summaries in British English (use -ise, -our spellings).",
    aiRegionalFocus:
      "Prioritise stories relevant to British readers: UK politics (Parliament, PM, parties), the British economy, UK-EU relations post-Brexit, Premier League and British sports (cricket, rugby, Formula 1), Commonwealth affairs. Maintain strong global coverage — at least 8 non-UK stories.",
    ui: {
      readSources: "Read sources",
      showingSince: "of",
      closingThought: "Today's Thought",
      noDigestYet: "No digest yet",
      noDigestSub: "Generate and publish a digest from the admin panel to start reading.",
      fallbackNotice: "not generated yet — showing latest available edition.",
      generateLink: "Generate →",
      prevStory: "Prev",
      nextStory: "Next",
      allStories: "All Stories",
      closingQuoteOf: "Closing Thought",
    },
    categories: {
      Technology: "Technology", Science: "Science", Business: "Business",
      Politics: "Politics", World: "World", Culture: "Culture",
      Health: "Health", Environment: "Environment", Sports: "Sports", Other: "Other",
    },
  },
  {
    id: "fr-FR",
    name: "France",
    country: "FR",
    flag: "🇫🇷",
    language: "fr",
    languageName: "Français",
    region: "europe",
    description: "Édition française — l'actualité mondiale en français",
    aiLanguageInstruction:
      "IMPORTANT: Write ALL titles and summaries in FRENCH (français). This is a French edition for French readers. Use standard French (not Quebec). All text must be in French — including category names, headlines, and summaries. Never write in English.",
    aiRegionalFocus:
      "Prioritise stories relevant to French readers: French politics (Élysée, Assemblée nationale, partis), the French economy (CAC 40, industrie française, PME), European Union politics (since France is central to EU), French culture (cinéma, littérature, gastronomie), football (Ligue 1, équipe de France, Champions League), francophone Africa. Still include 8+ international stories for global coverage.",
    ui: {
      readSources: "Lire les sources",
      showingSince: "sur",
      closingThought: "Pensée du jour",
      noDigestYet: "Aucun digest disponible",
      noDigestSub: "Générez et publiez un digest depuis le panneau d'administration pour commencer à lire.",
      fallbackNotice: "pas encore généré — affichage de la dernière édition disponible.",
      generateLink: "Générer →",
      prevStory: "Préc.",
      nextStory: "Suiv.",
      allStories: "Toutes les actualités",
      closingQuoteOf: "Pensée de clôture",
    },
    categories: {
      Technology: "Technologie", Science: "Science", Business: "Économie",
      Politics: "Politique", World: "Monde", Culture: "Culture",
      Health: "Santé", Environment: "Environnement", Sports: "Sport", Other: "Autre",
    },
  },
  {
    id: "de-DE",
    name: "Deutschland",
    country: "DE",
    flag: "🇩🇪",
    language: "de",
    languageName: "Deutsch",
    region: "europe",
    description: "Deutsche Ausgabe — Weltnachrichten auf Deutsch",
    aiLanguageInstruction:
      "WICHTIG: Schreibe ALLE Titel und Zusammenfassungen auf DEUTSCH. Dies ist eine deutsche Ausgabe für deutschsprachige Leser. Alle Texte müssen auf Deutsch sein — einschließlich Kategorienamen, Schlagzeilen und Zusammenfassungen. Niemals auf Englisch schreiben.",
    aiRegionalFocus:
      "Prioritise stories relevant to German readers: German politics (Bundestag, Bundesregierung, Parteien), the German economy (DAX, Automobilindustrie, Mittelstand, Energiewende), EU politics (Germany as central EU actor), DACH region (Austria, Switzerland), German sports (Bundesliga, DFB-Elf, Formel 1). Include at least 8 international stories for global coverage. Sports must include Bundesliga/German football.",
    ui: {
      readSources: "Quellen lesen",
      showingSince: "von",
      closingThought: "Gedanke des Tages",
      noDigestYet: "Noch kein Digest",
      noDigestSub: "Erstellen und veröffentlichen Sie einen Digest über das Admin-Panel, um mit dem Lesen zu beginnen.",
      fallbackNotice: "noch nicht generiert — zeige neueste verfügbare Ausgabe.",
      generateLink: "Generieren →",
      prevStory: "Vorh.",
      nextStory: "Näch.",
      allStories: "Alle Nachrichten",
      closingQuoteOf: "Abschlusszitat",
    },
    categories: {
      Technology: "Technologie", Science: "Wissenschaft", Business: "Wirtschaft",
      Politics: "Politik", World: "Welt", Culture: "Kultur",
      Health: "Gesundheit", Environment: "Umwelt", Sports: "Sport", Other: "Sonstiges",
    },
  },
  {
    id: "en-AU",
    name: "Australia",
    country: "AU",
    flag: "🇦🇺",
    language: "en",
    languageName: "English",
    region: "oceania",
    description: "Australian English — Asia-Pacific focus with world news",
    aiLanguageInstruction: "Write all titles and summaries in Australian English.",
    aiRegionalFocus:
      "Prioritise stories relevant to Australian readers: Australian politics (Parliament, PM, major parties), the Australian economy (mining, housing, China trade), Asia-Pacific region (China, Japan, SE Asia, Pacific Islands), Australian sports (AFL, NRL, cricket, tennis, swimming). Strong Asia coverage since Australia is geographically in the Asia-Pacific. Include 6+ non-Australian stories.",
    ui: {
      readSources: "Read sources",
      showingSince: "of",
      closingThought: "Today's Thought",
      noDigestYet: "No digest yet",
      noDigestSub: "Generate and publish a digest from the admin panel to start reading.",
      fallbackNotice: "not generated yet — showing latest available edition.",
      generateLink: "Generate →",
      prevStory: "Prev",
      nextStory: "Next",
      allStories: "All Stories",
      closingQuoteOf: "Closing Thought",
    },
    categories: {
      Technology: "Technology", Science: "Science", Business: "Business",
      Politics: "Politics", World: "World", Culture: "Culture",
      Health: "Health", Environment: "Environment", Sports: "Sports", Other: "Other",
    },
  },
];

/** Look up an edition by ID — falls back to World edition if not found */
export function getEdition(id: string): Edition {
  return EDITIONS.find(e => e.id === id) ?? EDITIONS[0];
}

/** The default edition shown on first load */
export const DEFAULT_EDITION = EDITIONS[0]; // en-WORLD
