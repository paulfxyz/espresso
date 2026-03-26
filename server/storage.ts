/**
 * @file server/storage.ts
 * @author Paul Fleury <hello@paulfleury.com>
 * @version 3.5.7
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

  -- v2.0.0+: digests table with (date, edition) composite unique key.
  -- Each edition can have one digest per day.
  -- NOTE: the original v1.x table had UNIQUE(date) only, preventing multi-edition.
  -- We cannot ALTER TABLE to drop a UNIQUE constraint in SQLite.
  -- This CREATE uses IF NOT EXISTS — if the old table exists it won't be recreated.
  -- The migration block below handles the old-table upgrade path.
  CREATE TABLE IF NOT EXISTS digests (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    date                 TEXT    NOT NULL,
    status               TEXT    NOT NULL DEFAULT 'draft',
    stories_json         TEXT    NOT NULL,
    closing_quote        TEXT,
    closing_quote_author TEXT,
    generated_at         TEXT,
    published_at         TEXT,
    edition              TEXT    NOT NULL DEFAULT 'en',
    UNIQUE(date, edition)
  );

  CREATE TABLE IF NOT EXISTS config (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- Index on submitted_at for efficient unprocessed link queries
  CREATE INDEX IF NOT EXISTS idx_links_processed ON links (processed_at);
  -- Index on digest date for fast lookup by date
  CREATE INDEX IF NOT EXISTS idx_digests_date ON digests (date);
  -- Index on digest (date, edition) for multi-edition lookups
  CREATE INDEX IF NOT EXISTS idx_digests_date_edition ON digests (date, edition);
  -- Index on digest status for fast latest-published query
  CREATE INDEX IF NOT EXISTS idx_digests_status ON digests (status, date);
`);

// ─── v2.0.0 Migration: add edition column (step 1) ───────────────────────────
// SQLite supports ADD COLUMN but not DROP/MODIFY. This is safe to run repeatedly.
try {
  sqlite.exec(`ALTER TABLE digests ADD COLUMN edition TEXT NOT NULL DEFAULT 'en';`);
  console.log("✅ Migration v2.0.0: added digests.edition column");
} catch {
  // Column already exists — expected on all runs after first migration
}

// ─── v2.0.3 Migration: fix UNIQUE constraint (date) → UNIQUE(date, edition) ────────
//
// THE PROBLEM:
//   The original digests table was created with `date TEXT NOT NULL UNIQUE`.
//   A UNIQUE constraint on (date) alone means only ONE digest per day, regardless
//   of edition. This prevented generating fr-FR, de-DE etc. on the same day as
//   en-WORLD — every attempt threw "UNIQUE constraint failed: digests.date".
//
// WHY WE CAN'T USE ALTER TABLE:
//   SQLite does not support ALTER TABLE DROP CONSTRAINT or ALTER TABLE MODIFY.
//   The only way to change a constraint is to rebuild the table.
//
// THE FIX: table rebuild ("12-step" SQLite ALTER pattern):
//   1. Create new table with correct UNIQUE(date, edition) constraint
//   2. Copy all data from old table
//   3. Drop old table
//   4. Rename new table to original name
//   5. Recreate indexes
//
// This migration is idempotent: if the column `edition` already exists AND
// the table was already rebuilt, the pragma check returns the correct schema
// and we skip. Detects via: checking if `digests` has a compound unique index.

try {
  // Check if we still have the old single-column unique constraint.
  // sqlite_master stores index definitions; the old constraint creates an
  // implicit index named 'sqlite_autoindex_digests_1' on a single column.
  const oldConstraint = sqlite.prepare(`
    SELECT COUNT(*) as cnt FROM sqlite_master
    WHERE type='table' AND name='digests'
    AND sql LIKE '%date%NOT NULL%UNIQUE%'
    AND sql NOT LIKE '%UNIQUE(date, edition)%'
  `).get() as { cnt: number };

  if (oldConstraint?.cnt > 0) {
    console.log("🔧 Migration v2.0.3: rebuilding digests table to fix UNIQUE(date) → UNIQUE(date,edition)");
    sqlite.exec(`
      BEGIN;

      CREATE TABLE digests_new (
        id                   INTEGER PRIMARY KEY AUTOINCREMENT,
        date                 TEXT    NOT NULL,
        status               TEXT    NOT NULL DEFAULT 'draft',
        stories_json         TEXT    NOT NULL,
        closing_quote        TEXT,
        closing_quote_author TEXT,
        generated_at         TEXT,
        published_at         TEXT,
        edition              TEXT    NOT NULL DEFAULT 'en',
        UNIQUE(date, edition)
      );

      INSERT INTO digests_new
        (id, date, status, stories_json, closing_quote, closing_quote_author,
         generated_at, published_at, edition)
      SELECT
        id, date, status, stories_json, closing_quote, closing_quote_author,
        generated_at, published_at,
        COALESCE(edition, 'en')
      FROM digests;

      DROP TABLE digests;
      ALTER TABLE digests_new RENAME TO digests;

      CREATE INDEX IF NOT EXISTS idx_digests_date ON digests (date);
      CREATE INDEX IF NOT EXISTS idx_digests_date_edition ON digests (date, edition);
      CREATE INDEX IF NOT EXISTS idx_digests_status ON digests (status, date);

      COMMIT;
    `);
    console.log("✅ Migration v2.0.3: digests table rebuilt with UNIQUE(date, edition)");
  }
} catch (e) {
  console.error("❌ Migration v2.0.3 failed:", e);
  // Non-fatal: app still runs, but multi-edition generation will be blocked.
}

// ─── Row Mapper ───────────────────────────────────────────────────────

/**
 * Map a raw better-sqlite3 row (snake_case) to the Digest TypeScript type (camelCase).
 *
 * WHY THIS EXISTS:
 *   Drizzle ORM's query builder automatically maps column names from snake_case
 *   (as stored in SQLite: stories_json, closing_quote, etc.) to camelCase
 *   (storiesJson, closingQuote, etc.) when using db.select().
 *
 *   But better-sqlite3's raw sqlite.prepare().get() bypasses Drizzle entirely
 *   and returns the raw SQLite column names unchanged. Any code that then calls
 *   digest.storiesJson gets `undefined` because the column is actually `stories_json`.
 *
 *   This function normalises both paths to the same camelCase shape.
 *   It's called only for the two methods that use raw SQL (getDigestByDate,
 *   getLatestPublishedDigest). The Drizzle-based methods don't need it.
 */
function mapDigestRow(row: any): any {
  return {
    id:                   row.id,
    date:                 row.date,
    status:               row.status,
    storiesJson:          row.storiesJson          ?? row.stories_json,
    closingQuote:         row.closingQuote         ?? row.closing_quote,
    closingQuoteAuthor:   row.closingQuoteAuthor   ?? row.closing_quote_author,
    generatedAt:          row.generatedAt          ?? row.generated_at,
    publishedAt:          row.publishedAt          ?? row.published_at,
    edition:              row.edition              ?? "en",
  };
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
  /**
   * v2.0.3: fallback — returns the most recent published digest across ALL editions.
   * Used when the requested edition has no digest yet so the reader is never empty.
   */
  getLatestPublishedDigestAny(): Digest | undefined;
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
   *
   * v2.0.0 bug fix: the original implementation used:
   *   .where(eq(digests.date, date) && eq(digests.edition, edition))
   * The `&&` operator is JavaScript boolean AND — it evaluates eq(digests.date, date)
   * as truthy, then returns eq(digests.edition, edition) as the result. This means
   * the WHERE clause only filtered by edition, ignoring the date entirely.
   * Fix: use raw SQL with parameterised query, which also sidesteps Drizzle's
   * and() import requirement.
   *
   * Column mapping: better-sqlite3 returns raw snake_case column names from raw SQL
   * (stories_json, closing_quote, etc). We must manually map to camelCase to match
   * the Digest TypeScript type that Drizzle's ORM queries produce automatically.
   */
  getDigestByDate(date: string, edition = "en"): Digest | undefined {
    const row = sqlite.prepare(
      `SELECT * FROM digests WHERE date = ? AND edition = ? LIMIT 1`
    ).get(date, edition) as any;
    return row ? mapDigestRow(row) : undefined;
  }

  /**
   * Most recent published digest for the given edition.
   *
   * v2.0.0 bug fix: raw SQL returns snake_case column names (stories_json, closing_quote)
   * but routes.ts does JSON.parse(digest.storiesJson) — camelCase. This caused
   * JSON.parse(undefined) → '"undefined" is not valid JSON' error on every page load.
   * Fix: mapDigestRow() converts snake_case → camelCase before returning.
   */
  getLatestPublishedDigest(edition = "en"): Digest | undefined {
    const row = sqlite.prepare(
      `SELECT * FROM digests WHERE status = 'published' AND edition = ? ORDER BY date DESC LIMIT 1`
    ).get(edition) as any;
    return row ? mapDigestRow(row) : undefined;
  }

  /**
   * Fallback: most recent published digest regardless of edition.
   * Called when the requested edition has no digest so the reader never shows a blank page.
   * The client receives a `fallbackEdition` field in the response so it can show
   * a notice: "Showing World edition — your edition hasn't been generated yet."
   */
  getLatestPublishedDigestAny(): Digest | undefined {
    const row = sqlite.prepare(
      `SELECT * FROM digests WHERE status = 'published' ORDER BY date DESC LIMIT 1`
    ).get() as any;
    return row ? mapDigestRow(row) : undefined;
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
