import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ─── Links ──────────────────────────────────────────────────────────────────
// Links submitted by user / API to feed into the digest pipeline.
export const links = sqliteTable("links", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  url: text("url").notNull(),
  title: text("title"),            // extracted or provided
  ogImage: text("og_image"),       // OG image extracted from URL
  contentHash: text("content_hash"), // SHA-256 of extracted text for dedup
  extractedText: text("extracted_text"), // Jina-extracted markdown
  sourceType: text("source_type").default("article"), // article | youtube | tiktok | tweet | other
  submittedAt: text("submitted_at").notNull(),
  processedAt: text("processed_at"), // null = not yet used in a digest
  digestId: integer("digest_id"),    // which digest used this link
  notes: text("notes"),              // optional user notes
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

// ─── Digests ─────────────────────────────────────────────────────────────────
// One digest = one morning edition.
export const digests = sqliteTable("digests", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  date: text("date").notNull(),          // YYYY-MM-DD
  status: text("status").notNull().default("draft"), // draft | published
  storiesJson: text("stories_json").notNull(), // JSON array of DigestStory[]
  closingQuote: text("closing_quote"),
  closingQuoteAuthor: text("closing_quote_author"),
  generatedAt: text("generated_at"),
  publishedAt: text("published_at"),
});

export const insertDigestSchema = createInsertSchema(digests).omit({ id: true });
export type InsertDigest = z.infer<typeof insertDigestSchema>;
export type Digest = typeof digests.$inferSelect;

// ─── Config ───────────────────────────────────────────────────────────────────
// Global app settings stored as key/value rows.
export const config = sqliteTable("config", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export type Config = typeof config.$inferSelect;

// ─── Shared types (not in DB) ─────────────────────────────────────────────────
export interface DigestStory {
  id: string;           // uuid for swapping
  title: string;
  summary: string;      // up to 200 words
  imageUrl: string;     // OG image or fallback
  sourceUrl: string;
  sourceTitle: string;
  category: string;     // e.g. "Technology", "World", "Science"
  linkId: number;
}
