import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq, isNull, and, desc } from "drizzle-orm";
import { links, digests, config, type Link, type InsertLink, type Digest, type InsertDigest } from "@shared/schema";
import path from "path";
import fs from "fs";

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), "espresso.db");
const sqlite = new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL");
const db = drizzle(sqlite);

// Auto-migrate
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT NOT NULL,
    title TEXT,
    og_image TEXT,
    content_hash TEXT,
    extracted_text TEXT,
    source_type TEXT DEFAULT 'article',
    submitted_at TEXT NOT NULL,
    processed_at TEXT,
    digest_id INTEGER,
    notes TEXT
  );

  CREATE TABLE IF NOT EXISTS digests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    stories_json TEXT NOT NULL,
    closing_quote TEXT,
    closing_quote_author TEXT,
    generated_at TEXT,
    published_at TEXT
  );

  CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

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
  getDigestByDate(date: string): Digest | undefined;
  getLatestPublishedDigest(): Digest | undefined;
  getAllDigests(): Digest[];
  updateDigest(id: number, updates: Partial<Digest>): Digest | undefined;
  deleteDigest(id: number): void;

  // Config
  getConfig(key: string): string | undefined;
  setConfig(key: string, value: string): void;
}

class Storage implements IStorage {
  // Links
  createLink(link: InsertLink): Link {
    const now = new Date().toISOString();
    return db.insert(links).values({ ...link, submittedAt: now }).returning().get();
  }

  getLink(id: number): Link | undefined {
    return db.select().from(links).where(eq(links.id, id)).get();
  }

  getAllLinks(): Link[] {
    return db.select().from(links).orderBy(desc(links.id)).all();
  }

  getUnprocessedLinks(): Link[] {
    return db.select().from(links).where(isNull(links.processedAt)).all();
  }

  updateLink(id: number, updates: Partial<Link>): Link | undefined {
    return db.update(links).set(updates).where(eq(links.id, id)).returning().get();
  }

  deleteLink(id: number): void {
    db.delete(links).where(eq(links.id, id)).run();
  }

  // Digests
  createDigest(digest: InsertDigest): Digest {
    return db.insert(digests).values(digest).returning().get();
  }

  getDigest(id: number): Digest | undefined {
    return db.select().from(digests).where(eq(digests.id, id)).get();
  }

  getDigestByDate(date: string): Digest | undefined {
    return db.select().from(digests).where(eq(digests.date, date)).get();
  }

  getLatestPublishedDigest(): Digest | undefined {
    return db.select().from(digests)
      .where(eq(digests.status, "published"))
      .orderBy(desc(digests.date))
      .get();
  }

  getAllDigests(): Digest[] {
    return db.select().from(digests).orderBy(desc(digests.date)).all();
  }

  updateDigest(id: number, updates: Partial<Digest>): Digest | undefined {
    return db.update(digests).set(updates).where(eq(digests.id, id)).returning().get();
  }

  deleteDigest(id: number): void {
    db.delete(digests).where(eq(digests.id, id)).run();
  }

  // Config
  getConfig(key: string): string | undefined {
    const row = db.select().from(config).where(eq(config.key, key)).get();
    return row?.value;
  }

  setConfig(key: string, value: string): void {
    db.insert(config).values({ key, value })
      .onConflictDoUpdate({ target: config.key, set: { value } })
      .run();
  }
}

export const storage = new Storage();
