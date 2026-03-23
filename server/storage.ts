/**
 * @file server/storage.ts
 * @author Paul Fleury <hello@paulfleury.com>
 * @version 2.0.0
 *
 * Cup of News — SQLite Storage Layer
 *
 * Context:
 *   All application state lives in a single SQLite file (cup-of-news.db).
 *   This file is the sole persistence layer — no Redis, no external DB.
 *   Drizzle ORM provides type-safe queries; better-sqlite3 is synchronous
 *   (no async/await needed for DB ops).
 *
 * Schema overview:
 *   links   — every URL submitted by the user or auto-fetched from RSS
 *   digests — one row per day; storiesJson holds the full DigestStory[]
 *   config  — key/value store for OPENROUTER_KEY and ADMIN_KEY
 *
 * Auto-migration:
 *   Tables are created with CREATE TABLE IF NOT EXISTS on startup.
 *   This means the app works out-of-the-box with no migration command.
 *   For future schema changes (adding columns), use ALTER TABLE in the
 *   migration block below — SQLite supports ADD COLUMN without rebuild.
 *
 * Performance notes:
 *   WAL mode is enabled — this gives significantly better read concurrency
 *   and is the recommended mode for any SQLite database with concurrent
 *   readers (the HTTP server + cron both read the DB).
 *   All queries return synchronously — no connection pool needed.
 *
 * Design decision — why SQLite and not Postgres:
 *   Cup of News is a personal tool. One user, one digest per day, ~100 links/month.
 *   SQLite is zero-infrastructure, file-based (easy backup: cp cup-of-news.db),
 *   and perfectly sufficient at this scale. Switching to Postgres later would
 *   require changing only this file and the schema — the rest of the app is
 *   storage-agnostic through the IStorage interface.
 */

import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq, isNull, desc } from "drizzle-orm";
import {
  links,
  digests,
  config,
  type Link,
  type InsertLink,
  type Digest,
  type InsertDigest,
} from "@shared/schema";
import path from "path";

// ─── Database Initialisation ──────────────────────────────────────────────────

const DB_PATH =
  process.env.DB_PATH || path.join(process.cwd(), "cup-of-news.db");

const sqlite = new Database(DB_PATH);

// WAL mode: better read concurrency, recommended for server workloads
sqlite.pragma("journal_mode = WAL");
// Enforce foreign key constraints (not used yet, but good practice)
sqlite.pragma("foreign_keys = ON");

const db = drizzle(sqlite);

// ─── Auto-migration ───────────────────────────────────────────────────────────
// Uses CREATE TABLE IF NOT EXISTS — safe to run on every startup.
// To add a column in a future version: ALTER TABLE links ADD COLUMN new_col TEXT;

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS links (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    url           TEXT    NOT NULL,
    title         TEXT,
    og_image      TEXT,
    content_hash  TEXT,
    extracted_text TEXT,
    source_type   TEXT    DEFAULT 'article',
    submitted_at  TEXT    NOT NULL,
    processed_at  TEXT,
    digest_id     INTEGER,
    notes         TEXT
  );

  CREATE TABLE IF NOT EXISTS digests (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    date                 TEXT    NOT NULL UNIQUE,
    status               TEXT    NOT NULL DEFAULT 'draft',
    stories_json         TEXT    NOT NULL,
    closing_quote        TEXT,
    closing_quote_author TEXT,
    generated_at         TEXT,
    published_at         TEXT
  );

  CREATE TABLE IF NOT EXISTS config (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- Index on submitted_at for efficient unprocessed link queries
  CREATE INDEX IF NOT EXISTS idx_links_processed ON links (processed_at);
  -- Index on digest date for fast lookup by date
  CREATE INDEX IF NOT EXISTS idx_digests_date ON digests (date);
  -- Index on digest status for fast latest-published query
  CREATE INDEX IF NOT EXISTS idx_digests_status ON digests (status, date);
`);

// ─── v2.0.0 Migration: add edition column ────────────────────────────────────
// SQLite supports ADD COLUMN but not DROP/MODIFY. This is safe to run repeatedly.
// Existing rows get the default 'en-WORLD' automatically via SQLite DEFAULT.
try {
  sqlite.exec(`ALTER TABLE digests ADD COLUMN edition TEXT NOT NULL DEFAULT 'en-WORLD';`);
  console.log("✅ Migration: added digests.edition column");
} catch {
  // Column already exists — expected on all runs after first migration
}

// ─── Storage Interface ────────────────────────────────────────────────────────

/**
 * IStorage defines the contract between the pipeline/routes and the DB.
 * Everything goes through this interface — routes never import drizzle directly.
 * This makes it trivial to swap SQLite for Postgres later.
 */
export interface IStorage {
  // Links
  createLink(link: InsertLink): Link;
  getLink(id: number): Link | undefined;
  getAllLinks(): Link[];
  getUnprocessedLinks(): Link[];
  updateLink(id: number, updates: Partial<Link>): Link | undefined;
  deleteLink(id: number): void;

  // Digests
  createDigest(digest: InsertDigest): Digest;
  getDigest(id: number): Digest | undefined;
  /** v2.0.0: edition-aware — returns digest for (date, edition) pair */
  getDigestByDate(date: string, edition?: string): Digest | undefined;
  /** v2.0.0: returns most recent published digest for the given edition */
  getLatestPublishedDigest(edition?: string): Digest | undefined;
  getAllDigests(): Digest[];
  updateDigest(id: number, updates: Partial<Digest>): Digest | undefined;
  deleteDigest(id: number): void;

  // Config
  getConfig(key: string): string | undefined;
  setConfig(key: string, value: string): void;
}

// ─── Implementation ───────────────────────────────────────────────────────────

class Storage implements IStorage {
  // ── Links ──────────────────────────────────────────────────────────────────

  createLink(link: InsertLink): Link {
    return db
      .insert(links)
      .values({ ...link, submittedAt: new Date().toISOString() })
      .returning()
      .get();
  }

  getLink(id: number): Link | undefined {
    return db.select().from(links).where(eq(links.id, id)).get();
  }

  /** Returns all links ordered by most recent first */
  getAllLinks(): Link[] {
    return db.select().from(links).orderBy(desc(links.id)).all();
  }

  /** Returns links that haven't been used in any digest yet */
  getUnprocessedLinks(): Link[] {
    return db.select().from(links).where(isNull(links.processedAt)).all();
  }

  updateLink(id: number, updates: Partial<Link>): Link | undefined {
    return db.update(links).set(updates).where(eq(links.id, id)).returning().get();
  }

  deleteLink(id: number): void {
    db.delete(links).where(eq(links.id, id)).run();
  }

  // ── Digests ────────────────────────────────────────────────────────────────

  createDigest(digest: InsertDigest): Digest {
    return db.insert(digests).values(digest).returning().get();
  }

  getDigest(id: number): Digest | undefined {
    return db.select().from(digests).where(eq(digests.id, id)).get();
  }

  /**
   * Get digest by date and edition.
   * v2.0.0: edition parameter added. Defaults to "en-WORLD" for backwards compatibility.
   * The unique key is now (date, edition) — one digest per day per edition.
   */
  getDigestByDate(date: string, edition = "en-WORLD"): Digest | undefined {
    return db
      .select()
      .from(digests)
      .where(eq(digests.date, date) && eq(digests.edition, edition) as any)
      .get();
  }

  /**
   * Most recent published digest for the given edition.
   * v2.0.0: edition parameter added. Defaults to "en-WORLD".
   * Used by GET /api/digest/latest?edition=...
   */
  getLatestPublishedDigest(edition = "en-WORLD"): Digest | undefined {
    // Use raw SQL for the multi-column WHERE to avoid Drizzle AND() import issues
    return (sqlite.prepare(
      `SELECT * FROM digests WHERE status = 'published' AND edition = ? ORDER BY date DESC LIMIT 1`
    ).get(edition)) as Digest | undefined;
  }

  /** All digests, newest first — used by admin panel */
  getAllDigests(): Digest[] {
    return db.select().from(digests).orderBy(desc(digests.date)).all();
  }

  updateDigest(id: number, updates: Partial<Digest>): Digest | undefined {
    return db.update(digests).set(updates).where(eq(digests.id, id)).returning().get();
  }

  deleteDigest(id: number): void {
    db.delete(digests).where(eq(digests.id, id)).run();
  }

  // ── Config ─────────────────────────────────────────────────────────────────

  getConfig(key: string): string | undefined {
    const row = db.select().from(config).where(eq(config.key, key)).get();
    return row?.value;
  }

  /**
   * Upsert a config value.
   * Uses ON CONFLICT DO UPDATE (SQLite UPSERT) — safe to call repeatedly.
   */
  setConfig(key: string, value: string): void {
    db.insert(config)
      .values({ key, value })
      .onConflictDoUpdate({ target: config.key, set: { value } })
      .run();
  }
}

export const storage = new Storage();
