import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { insertLinkSchema } from "@shared/schema";
import type { DigestStory } from "@shared/schema";
import { runDailyPipeline, swapStory } from "./pipeline";
import { z } from "zod";

function requireApiKey(req: any, res: any, next: any) {
  const adminKey = storage.getConfig("admin_key");
  if (!adminKey) return next(); // no key set = open
  const provided = req.headers["x-admin-key"] || req.query.adminKey;
  if (provided !== adminKey) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

export function registerRoutes(httpServer: Server, app: Express) {
  // ─── Health ──────────────────────────────────────────────────────────────
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", version: "1.0.0" });
  });

  // ─── Setup ───────────────────────────────────────────────────────────────
  // POST /api/setup — initial configuration (OpenRouter key, admin key)
  app.post("/api/setup", (req, res) => {
    const { openRouterKey, adminKey } = req.body;
    const existingKey = storage.getConfig("openrouter_key");

    // Only allow setup once unless no key exists
    if (existingKey && !req.headers["x-admin-key"]) {
      return res.status(403).json({ error: "Already configured. Use admin key to reconfigure." });
    }

    if (openRouterKey) storage.setConfig("openrouter_key", openRouterKey);
    if (adminKey) storage.setConfig("admin_key", adminKey);

    res.json({ success: true, message: "Configuration saved." });
  });

  // GET /api/setup/status — check if configured
  app.get("/api/setup/status", (_req, res) => {
    const configured = !!storage.getConfig("openrouter_key");
    const adminKeySet = !!storage.getConfig("admin_key");
    res.json({ configured, adminKeySet });
  });

  // ─── Links ────────────────────────────────────────────────────────────────
  // POST /api/links — submit one or more links
  app.post("/api/links", requireApiKey, (req, res) => {
    try {
      // Accept { url } or { urls: [] }
      const body = req.body;
      const urls: string[] = body.urls || (body.url ? [body.url] : []);

      if (urls.length === 0) {
        return res.status(400).json({ error: "Provide url or urls[]" });
      }

      const created = urls.map(url => {
        const notes = body.notes || null;
        return storage.createLink({ url, notes });
      });

      res.status(201).json({ created: created.length, links: created });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // GET /api/links — list all links
  app.get("/api/links", requireApiKey, (_req, res) => {
    res.json(storage.getAllLinks());
  });

  // DELETE /api/links/:id
  app.delete("/api/links/:id", requireApiKey, (req, res) => {
    storage.deleteLink(Number(req.params.id));
    res.json({ success: true });
  });

  // ─── Digest ───────────────────────────────────────────────────────────────
  // GET /api/digest/latest — latest published digest (public)
  app.get("/api/digest/latest", (_req, res) => {
    const digest = storage.getLatestPublishedDigest();
    if (!digest) return res.status(404).json({ error: "No published digest yet" });
    res.json({
      ...digest,
      stories: JSON.parse(digest.storiesJson),
    });
  });

  // GET /api/digest/:id — single digest by id
  app.get("/api/digest/:id", (_req, res) => {
    const digest = storage.getDigest(Number(_req.params.id));
    if (!digest) return res.status(404).json({ error: "Not found" });
    res.json({ ...digest, stories: JSON.parse(digest.storiesJson) });
  });

  // GET /api/digests — list all digests (admin)
  app.get("/api/digests", requireApiKey, (_req, res) => {
    const all = storage.getAllDigests().map(d => ({
      ...d,
      stories: JSON.parse(d.storiesJson),
    }));
    res.json(all);
  });

  // POST /api/digest/generate — trigger pipeline manually
  app.post("/api/digest/generate", requireApiKey, async (req, res) => {
    const apiKey = storage.getConfig("openrouter_key");
    if (!apiKey) return res.status(400).json({ error: "OpenRouter API key not configured. Visit /setup." });

    try {
      const result = await runDailyPipeline(apiKey);
      res.json({ success: true, ...result });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/digest/:id/publish — publish a draft
  app.post("/api/digest/:id/publish", requireApiKey, (req, res) => {
    const digest = storage.getDigest(Number(req.params.id));
    if (!digest) return res.status(404).json({ error: "Not found" });

    const updated = storage.updateDigest(digest.id, {
      status: "published",
      publishedAt: new Date().toISOString(),
    });
    res.json({ success: true, digest: updated });
  });

  // POST /api/digest/:id/unpublish
  app.post("/api/digest/:id/unpublish", requireApiKey, (req, res) => {
    const digest = storage.getDigest(Number(req.params.id));
    if (!digest) return res.status(404).json({ error: "Not found" });

    storage.updateDigest(digest.id, { status: "draft", publishedAt: null });
    res.json({ success: true });
  });

  // DELETE /api/digest/:id
  app.delete("/api/digest/:id", requireApiKey, (req, res) => {
    storage.deleteDigest(Number(req.params.id));
    res.json({ success: true });
  });

  // PATCH /api/digest/:id/story/:storyId/swap — swap one story
  app.patch("/api/digest/:id/story/:storyId/swap", requireApiKey, async (req, res) => {
    const apiKey = storage.getConfig("openrouter_key");
    if (!apiKey) return res.status(400).json({ error: "OpenRouter key not configured" });

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

  // PATCH /api/digest/:id/story/:storyId — edit a story manually
  app.patch("/api/digest/:id/story/:storyId", requireApiKey, (req, res) => {
    const digest = storage.getDigest(Number(req.params.id));
    if (!digest) return res.status(404).json({ error: "Not found" });

    const stories: DigestStory[] = JSON.parse(digest.storiesJson);
    const idx = stories.findIndex(s => s.id === req.params.storyId);
    if (idx === -1) return res.status(404).json({ error: "Story not found" });

    const { title, summary, category } = req.body;
    if (title) stories[idx].title = title;
    if (summary) stories[idx].summary = summary;
    if (category) stories[idx].category = category;

    storage.updateDigest(digest.id, { storiesJson: JSON.stringify(stories) });
    res.json({ success: true, story: stories[idx] });
  });

  // PATCH /api/digest/:id/quote — update closing quote
  app.patch("/api/digest/:id/quote", requireApiKey, (req, res) => {
    const { closingQuote, closingQuoteAuthor } = req.body;
    const updated = storage.updateDigest(Number(req.params.id), {
      closingQuote,
      closingQuoteAuthor,
    });
    res.json({ success: true, digest: updated });
  });

  // POST /api/digest/:id/reorder — reorder stories
  app.post("/api/digest/:id/reorder", requireApiKey, (req, res) => {
    const { storyIds } = req.body; // array of story IDs in new order
    const digest = storage.getDigest(Number(req.params.id));
    if (!digest) return res.status(404).json({ error: "Not found" });

    const stories: DigestStory[] = JSON.parse(digest.storiesJson);
    const reordered = storyIds
      .map((id: string) => stories.find(s => s.id === id))
      .filter(Boolean);

    storage.updateDigest(digest.id, { storiesJson: JSON.stringify(reordered) });
    res.json({ success: true });
  });
}
