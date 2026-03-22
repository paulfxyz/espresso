/**
 * @file server/routes.ts
 * @author Paul Fleury <hello@paulfleury.com>
 * @version 0.2.0
 *
 * Espresso — REST API Routes
 *
 * Context:
 *   All HTTP endpoints are registered here via registerRoutes().
 *   Routes are intentionally thin — they validate input, call storage
 *   or pipeline functions, and return JSON. No business logic lives here.
 *
 * Authentication:
 *   Write endpoints are protected by the requireApiKey middleware.
 *   If no ADMIN_KEY is configured, all endpoints are open (development mode).
 *   Public read endpoints (digest/latest, digest/:id, health) have no auth.
 *
 * Endpoint groups:
 *   /api/health          — public health check
 *   /api/setup           — first-run configuration (OpenRouter key + admin key)
 *   /api/links           — link submission and management
 *   /api/digest(s)       — digest generation, editing, publishing
 *
 * Error handling:
 *   All endpoints return { error: string } on failure.
 *   HTTP 400 = bad input, 401 = unauthorized, 404 = not found, 500 = pipeline error.
 *
 * Design note on POST /api/digest/generate:
 *   Generation can take 30-90 seconds (Jina extraction + AI call).
 *   The endpoint holds the connection open and returns when done.
 *   For production deployments with aggressive timeouts (Cloudflare: 100s),
 *   consider moving generation to a background job and polling for status.
 *   This is tracked as a v1.0.0 improvement.
 */

import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import type { DigestStory } from "@shared/schema";
import { runDailyPipeline, swapStory } from "./pipeline";

// ─── Auth Middleware ──────────────────────────────────────────────────────────

/**
 * Middleware: require x-admin-key header if an admin key is configured.
 * If no key is set (fresh install / dev mode), all requests pass through.
 *
 * Key is read from DB on each request (not cached) — this allows the admin
 * to change the key via the setup endpoint and have it take effect immediately.
 */
function requireApiKey(req: any, res: any, next: any) {
  const adminKey = storage.getConfig("admin_key");
  if (!adminKey) return next(); // no key configured = open access

  const provided =
    (req.headers["x-admin-key"] as string) ||
    (req.query.adminKey as string);

  if (provided !== adminKey) {
    return res.status(401).json({ error: "Unauthorized — x-admin-key header required" });
  }
  next();
}

// ─── Route Registration ───────────────────────────────────────────────────────

export function registerRoutes(httpServer: Server, app: Express) {

  // ── Health ─────────────────────────────────────────────────────────────────

  /**
   * GET /api/health
   * Public. Used by uptime monitors, Docker HEALTHCHECK, GitHub Actions.
   */
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", version: "0.2.0" });
  });

  // ── Setup ──────────────────────────────────────────────────────────────────

  /**
   * POST /api/setup
   * Save OpenRouter API key and optional admin key.
   * First call is open. Subsequent calls require x-admin-key.
   *
   * Body: { openRouterKey?: string, adminKey?: string }
   */
  app.post("/api/setup", (req, res) => {
    const { openRouterKey, adminKey } = req.body || {};
    const existingKey = storage.getConfig("openrouter_key");

    // Lock down re-configuration once a key exists
    if (existingKey) {
      const adminKeyInDb = storage.getConfig("admin_key");
      const provided = req.headers["x-admin-key"] as string;
      if (adminKeyInDb && provided !== adminKeyInDb) {
        return res.status(403).json({
          error: "Already configured. Provide x-admin-key to reconfigure.",
        });
      }
    }

    if (openRouterKey) storage.setConfig("openrouter_key", openRouterKey);
    if (adminKey) storage.setConfig("admin_key", adminKey);

    if (!openRouterKey && !adminKey) {
      return res.status(400).json({ error: "Provide at least openRouterKey or adminKey" });
    }

    res.json({ success: true, message: "Configuration saved." });
  });

  /**
   * GET /api/setup/status
   * Public. Frontend uses this to decide whether to show the setup wizard.
   */
  app.get("/api/setup/status", (_req, res) => {
    res.json({
      configured: !!storage.getConfig("openrouter_key"),
      adminKeySet: !!storage.getConfig("admin_key"),
    });
  });

  // ── Links ──────────────────────────────────────────────────────────────────

  /**
   * POST /api/links
   * Submit one or multiple URLs to the digest pool.
   *
   * Body: { url: string } or { urls: string[] }
   * Optional: { notes: string } — editorial note shown in admin panel
   *
   * URLs are stored immediately; content extraction happens at generation time.
   */
  app.post("/api/links", requireApiKey, (req, res) => {
    try {
      const body = req.body || {};
      const urls: string[] = body.urls || (body.url ? [body.url] : []);

      if (urls.length === 0) {
        return res.status(400).json({ error: "Provide url or urls[]" });
      }

      // Basic URL validation
      const validUrls = urls.filter((u) => {
        try { new URL(u); return true; } catch { return false; }
      });

      if (validUrls.length === 0) {
        return res.status(400).json({ error: "No valid URLs provided" });
      }

      const created = validUrls.map((url) =>
        storage.createLink({ url, notes: body.notes || null })
      );

      res.status(201).json({ created: created.length, links: created });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  /**
   * GET /api/links
   * Admin. Returns all submitted links with status.
   */
  app.get("/api/links", requireApiKey, (_req, res) => {
    res.json(storage.getAllLinks());
  });

  /**
   * DELETE /api/links/:id
   * Admin. Remove a link from the pool.
   */
  app.delete("/api/links/:id", requireApiKey, (req, res) => {
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    storage.deleteLink(id);
    res.json({ success: true });
  });

  // ── Digest — Read (Public) ─────────────────────────────────────────────────

  /**
   * GET /api/digest/latest
   * Public. Returns the latest published digest with stories parsed from JSON.
   * This is the endpoint the reader frontend hits on every load.
   */
  app.get("/api/digest/latest", (_req, res) => {
    const digest = storage.getLatestPublishedDigest();
    if (!digest) return res.status(404).json({ error: "No published digest yet" });
    res.json({ ...digest, stories: JSON.parse(digest.storiesJson) });
  });

  /**
   * GET /api/digest/:id
   * Public. Returns any single digest by ID (draft or published).
   * Used for direct links and admin preview.
   */
  app.get("/api/digest/:id", (req, res) => {
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const digest = storage.getDigest(id);
    if (!digest) return res.status(404).json({ error: "Digest not found" });
    res.json({ ...digest, stories: JSON.parse(digest.storiesJson) });
  });

  // ── Digest — Admin ─────────────────────────────────────────────────────────

  /**
   * GET /api/digests
   * Admin. Returns all digests with stories, newest first.
   */
  app.get("/api/digests", requireApiKey, (_req, res) => {
    const all = storage.getAllDigests().map((d) => ({
      ...d,
      stories: JSON.parse(d.storiesJson),
    }));
    res.json(all);
  });

  /**
   * POST /api/digest/generate
   * Admin. Triggers the full daily pipeline.
   *
   * This is a synchronous long-poll — it holds the connection until generation
   * completes (typically 15-90 seconds depending on number of links and Jina
   * extraction speed). Returns { success, digestId, storiesCount } on success.
   *
   * Note: if today's digest is already published, returns 409 Conflict.
   */
  app.post("/api/digest/generate", requireApiKey, async (req, res) => {
    const apiKey = storage.getConfig("openrouter_key");
    if (!apiKey) {
      return res.status(400).json({
        error: "OpenRouter API key not configured. Visit /#/setup to configure.",
      });
    }

    try {
      const result = await runDailyPipeline(apiKey);
      res.json({ success: true, ...result });
    } catch (e: any) {
      const statusCode = e.message?.includes("already exists") ? 409 : 500;
      res.status(statusCode).json({ error: e.message });
    }
  });

  /**
   * POST /api/digest/:id/publish
   * Admin. Marks a draft digest as published and sets publishedAt timestamp.
   */
  app.post("/api/digest/:id/publish", requireApiKey, (req, res) => {
    const id = Number(req.params.id);
    const digest = storage.getDigest(id);
    if (!digest) return res.status(404).json({ error: "Digest not found" });

    const updated = storage.updateDigest(id, {
      status: "published",
      publishedAt: new Date().toISOString(),
    });
    res.json({ success: true, digest: updated });
  });

  /**
   * POST /api/digest/:id/unpublish
   * Admin. Reverts a published digest to draft (clears publishedAt).
   * Also allows re-generation of the same day's digest.
   */
  app.post("/api/digest/:id/unpublish", requireApiKey, (req, res) => {
    const id = Number(req.params.id);
    const digest = storage.getDigest(id);
    if (!digest) return res.status(404).json({ error: "Digest not found" });

    storage.updateDigest(id, { status: "draft", publishedAt: null });
    res.json({ success: true });
  });

  /**
   * DELETE /api/digest/:id
   * Admin. Permanently deletes a digest.
   */
  app.delete("/api/digest/:id", requireApiKey, (req, res) => {
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    storage.deleteDigest(id);
    res.json({ success: true });
  });

  // ── Story-level editing ────────────────────────────────────────────────────

  /**
   * PATCH /api/digest/:id/story/:storyId/swap
   * Admin. Replace a story with another from the unused link pool.
   * Triggers a fresh AI summarization of the replacement story.
   * Takes ~5-10 seconds (one Jina fetch + one OpenRouter call).
   */
  app.patch("/api/digest/:id/story/:storyId/swap", requireApiKey, async (req, res) => {
    const apiKey = storage.getConfig("openrouter_key");
    if (!apiKey) {
      return res.status(400).json({ error: "OpenRouter key not configured" });
    }

    try {
      const newStory = await swapStory(
        Number(req.params.id),
        req.params.storyId,
        apiKey
      );
      res.json({ success: true, story: newStory });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * PATCH /api/digest/:id/story/:storyId
   * Admin. Manually edit a story's title, summary, or category.
   * Body: { title?, summary?, category? }
   */
  app.patch("/api/digest/:id/story/:storyId", requireApiKey, (req, res) => {
    const digest = storage.getDigest(Number(req.params.id));
    if (!digest) return res.status(404).json({ error: "Digest not found" });

    const stories: DigestStory[] = JSON.parse(digest.storiesJson);
    const idx = stories.findIndex((s) => s.id === req.params.storyId);
    if (idx === -1) return res.status(404).json({ error: "Story not found" });

    const { title, summary, category } = req.body || {};
    if (title) stories[idx].title = title;
    if (summary) stories[idx].summary = summary;
    if (category) stories[idx].category = category;

    storage.updateDigest(digest.id, { storiesJson: JSON.stringify(stories) });
    res.json({ success: true, story: stories[idx] });
  });

  /**
   * PATCH /api/digest/:id/quote
   * Admin. Edit the closing quote and author.
   * Body: { closingQuote: string, closingQuoteAuthor: string }
   */
  app.patch("/api/digest/:id/quote", requireApiKey, (req, res) => {
    const id = Number(req.params.id);
    const { closingQuote, closingQuoteAuthor } = req.body || {};
    if (!closingQuote) {
      return res.status(400).json({ error: "closingQuote is required" });
    }
    const updated = storage.updateDigest(id, { closingQuote, closingQuoteAuthor });
    if (!updated) return res.status(404).json({ error: "Digest not found" });
    res.json({ success: true, digest: updated });
  });

  /**
   * POST /api/digest/:id/reorder
   * Admin. Reorder stories by providing a new array of story IDs.
   * Body: { storyIds: string[] }
   */
  app.post("/api/digest/:id/reorder", requireApiKey, (req, res) => {
    const digest = storage.getDigest(Number(req.params.id));
    if (!digest) return res.status(404).json({ error: "Digest not found" });

    const { storyIds } = req.body || {};
    if (!Array.isArray(storyIds)) {
      return res.status(400).json({ error: "storyIds must be an array" });
    }

    const stories: DigestStory[] = JSON.parse(digest.storiesJson);
    const reordered = storyIds
      .map((id: string) => stories.find((s) => s.id === id))
      .filter(Boolean) as DigestStory[];

    if (reordered.length === 0) {
      return res.status(400).json({ error: "No valid story IDs provided" });
    }

    storage.updateDigest(digest.id, { storiesJson: JSON.stringify(reordered) });
    res.json({ success: true });
  });
}
