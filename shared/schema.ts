/**
 * @file shared/schema.ts
 * @author Paul Fleury <hello@paulfleury.com>
 * @version 3.3.4
 *
 * Cup of News — Shared Data Schema
 *
 * Context:
 *   This file is the single source of truth for all data structures used
 *   by both the frontend (TypeScript types) and backend (Drizzle ORM schema).
 *   It lives in /shared/ so it can be imported by both server/ and client/src/.
 *
 * Contents:
 *   - SQLite table definitions (Drizzle)
 *   - Zod insert schemas (for API validation)
 *   - TypeScript types derived from schemas (no duplication)
 *   - DigestStory — the in-memory shape of a single digest story
 *
 * DigestStory vs Link:
 *   A Link is what the user submits. A DigestStory is what the AI produces
 *   from that link (curated title, 200-word summary, category, image).
 *   DigestStory is stored as JSON inside digests.stories_json — not as a
 *   separate table — because stories are always read/written as a unit.
 *
 * Adding a new column:
 *   1. Add to the sqliteTable definition below
 *   2. Add to the CREATE TABLE / ALTER TABLE in server/storage.ts
 *   3. Update the IStorage interface if needed
 *   4. TypeScript types update automatically via $inferSelect
 */

import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ─── Links Table ──────────────────────────────────────────────────────────────

/**
 * links — every URL submitted by the user or surfaced by the RSS fallback.
 *
 * Lifecycle of a link:
 *   1. Created via POST /api/links (processedAt = null)
 *   2. Pipeline extracts content and caches it (extractedText, title, ogImage)
 *   3. AI selects it → processedAt + digestId set
 *   4. If swapped out → processedAt + digestId reset to null (back in pool)
 */
export const links = sqliteTable("links", {
  id: integer("id").primaryKey({ autoIncrement: true }),

  /** The original URL as submitted */
  url: text("url").notNull(),

  /** Extracted or AI-generated title — null until pipeline processes this link */
  title: text("title"),

  /** OG image URL extracted from Jina reader or HTML metadata */
  ogImage: text("og_image"),

  /** SHA-256 of extracted text — used to detect content updates and dedup */
  contentHash: text("content_hash"),

  /** Full text extracted by Jina Reader, capped at ~8000 chars */
  extractedText: text("extracted_text"),

  /** Detected content type: article | youtube | tiktok | tweet | reddit | substack | trend */
  sourceType: text("source_type").default("article"),

  /** ISO timestamp when this URL was submitted */
  submittedAt: text("submitted_at").notNull(),

  /** ISO timestamp when this link was used in a digest (null = still in pool) */
  processedAt: text("processed_at"),

  /** ID of the digest that used this link */
  digestId: integer("digest_id"),

  /** Optional editorial notes (admin-facing, not shown in reader) */
  notes: text("notes"),
});

export const insertLinkSchema = createInsertSchema(links).omit({
  id: true,
  submittedAt: true,
  processedAt: true,
  digestId: true,
  contentHash: true,
  extractedText: true,
  ogImage: true,
});

export type InsertLink = z.infer<typeof insertLinkSchema>;
export type Link = typeof links.$inferSelect;

// ─── Digests Table ────────────────────────────────────────────────────────────

/**
 * digests — one row per daily edition.
 *
 * storiesJson stores the full DigestStory[] array as JSON text.
 * Stories are not normalized into a separate table because they're always
 * read/written together and the array is small (max 10 items).
 *
 * Status lifecycle: draft → published (→ draft again if unpublished)
 */
export const digests = sqliteTable("digests", {
  id: integer("id").primaryKey({ autoIncrement: true }),

  /** YYYY-MM-DD — unique constraint prevents two digests for the same day */
  date: text("date").notNull(),

  /** draft | published */
  status: text("status").notNull().default("draft"),

  /** JSON-serialized DigestStory[] — see type below */
  storiesJson: text("stories_json").notNull(),

  /** AI-generated closing quote */
  closingQuote: text("closing_quote"),

  /** Attribution for closing quote, e.g. "Albert Camus, The Plague" */
  closingQuoteAuthor: text("closing_quote_author"),

  /** ISO timestamp of when the AI pipeline ran */
  generatedAt: text("generated_at"),

  /** ISO timestamp of when the admin published — null for drafts */
  publishedAt: text("published_at"),

  /**
   * Edition identifier — BCP 47 locale tag (e.g. "en-WORLD", "fr-FR", "de-DE").
   * Added in v2.0.0. The unique constraint shifts from (date) to (date, edition)
   * allowing up to 8 independent digests per day — one per edition.
   *
   * Migration: existing rows default to "en-WORLD" (applied in storage.ts AUTO-MIGRATE).
   */
  edition: text("edition").notNull().default("en-WORLD"),
});

export const insertDigestSchema = createInsertSchema(digests).omit({ id: true });
export type InsertDigest = z.infer<typeof insertDigestSchema>;
export type Digest = typeof digests.$inferSelect;

// ─── Config Table ─────────────────────────────────────────────────────────────

/**
 * config — simple key/value store for application settings.
 *
 * Keys in use:
 *   openrouter_key — the OpenRouter API key (sk-or-v1-...)
 *   admin_key      — protects write endpoints (x-admin-key header)
 */
export const config = sqliteTable("config", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export type Config = typeof config.$inferSelect;

// ─── DigestStory (not a DB table) ─────────────────────────────────────────────

/**
 * DigestStory — the shape of a single story inside a digest.
 *
 * This is stored as JSON within digests.stories_json, not as a DB row.
 * The frontend uses this type directly.
 *
 * id         — random UUID, stable across edits (used for swap, reorder, edit)
 * linkId     — 0 for trend items (no link row in DB), >0 for user-submitted
 */
export interface DigestStory {
  /** UUID — stable identifier for this story within a digest */
  id: string;

  /** AI-generated headline (max 80 chars) */
  title: string;

  /** AI-generated editorial summary (max 200 words) */
  summary: string;

  /** Hero image URL — from OG metadata or picsum.photos fallback */
  imageUrl: string;

  /** Original source URL */
  sourceUrl: string;

  /** Source page title (shown in reader as attribution) */
  sourceTitle: string;

  /** Editorial category — one of the fixed set defined in pipeline.ts */
  category: string;

  /** FK to links.id — 0 for trend items, >0 for user-submitted links */
  linkId: number;

  /**
   * Up to 3 source URLs and titles used to compile this story.
   * Populated by the AI from the contentItems it received.
   * The primary source is always sourceUrl; these are additional references.
   */
  sources?: Array<{ url: string; title: string; domain: string }>;
}
