/**
 * @file server/routes.ts
 * @author Paul Fleury <hello@paulfleury.com>
 * @version 3.4.6
 *
 * Cup of News — REST API Routes
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

  const provided =
    (req.headers["x-admin-key"] as string) ||
    (req.query.adminKey as string) ||
    "";

  // No key configured yet: accept the default "admin" password or any provided key
  if (!adminKey) {
    if (!provided || provided === "admin") return next();
    // Key provided but nothing set in DB yet — still accept (first-time setup)
    return next();
  }

  if (provided !== adminKey) {
    return res.status(401).json({ error: "Unauthorized — incorrect password" });
  }
  next();
}

// ─── Route Registration ───────────────────────────────────────────────────────

export function registerRoutes(httpServer: Server, app: Express) {

  // ── Admin password change ─────────────────────────────────────────────────

  /**
   * POST /api/admin/change-password
   * Admin. Change the admin password (admin_key in config).
   * Requires current password via x-admin-key header.
   * Body: { newPassword: string }
   *
   * Special case: if no admin key is set yet and the user provides "admin"
   * as the current key (the default), accept it and set the new one.
   */
  app.post("/api/admin/change-password", requireApiKey, (req, res) => {
    const { newPassword } = req.body || {};
    if (!newPassword || typeof newPassword !== "string" || newPassword.length < 4) {
      return res.status(400).json({ error: "Password must be at least 4 characters" });
    }
    storage.setConfig("admin_key", newPassword);
    res.json({ success: true, message: "Password updated. Use the new password on next login." });
  });

  // ── Health ─────────────────────────────────────────────────────────────────

  /**
   * GET /api/health
   * Public. Used by uptime monitors, Docker HEALTHCHECK, GitHub Actions.
   */
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", version: "3.4.6" });
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
   * GET /api/digest/latest?edition=en-WORLD
   * Public. Returns the latest published digest for the given edition.
   *
   * v2.0.3: NEVER returns 404 to the reader.
   * Fallback cascade:
   *   1. Exact edition match (e.g. fr-FR)
   *   2. Any published digest regardless of edition (so the reader always has content)
   *   3. 404 only if the database is completely empty
   *
   * When falling back to a different edition, the response includes:
   *   { isFallback: true, requestedEdition: "fr-FR", edition: "en" }
   * The client can use this to show a non-intrusive notice:
   *   "Showing World edition — your edition hasn't been generated yet."
   *
   * Design decision: a reader switching to the French edition for the first time
   * should see SOMETHING rather than a blank screen. An empty state is
   * the worst possible first impression and discourages generating new editions.
   */
  app.get("/api/digest/latest", (req, res) => {
    const requestedEdition = (req.query.edition as string) || "en";

    // Try exact edition first
    let digest = storage.getLatestPublishedDigest(requestedEdition);
    let isFallback = false;

    // Fallback: any published digest
    if (!digest) {
      digest = storage.getLatestPublishedDigestAny();
      isFallback = !!digest;
    }

    if (!digest) {
      return res.status(404).json({ error: "No digest published yet. Generate and publish one from the admin panel." });
    }

    // Cache the digest response for 5 minutes at the browser + CDN edge.
    // The digest changes at most twice a day (6AM + 4PM GMT cron).
    // 5 min is short enough that a fresh generate is visible quickly,
    // long enough to meaningfully reduce load on the Fly.io machine.
    // Cloudflare will respect s-maxage for edge caching.
    res.setHeader("Cache-Control", "public, max-age=300, s-maxage=300, stale-while-revalidate=60");
    res.json({
      ...digest,
      stories: JSON.parse(digest.storiesJson),
      isFallback,
      requestedEdition: isFallback ? requestedEdition : undefined,
    });
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
   * Admin. Triggers the full daily pipeline for a specific edition.
   *
   * v2.0.0: Body can include { edition: "fr" } to generate a specific edition.
   * Defaults to "en" for backwards compatibility.
   *
   * This is a synchronous long-poll — holds connection until generation
   * completes (15-90 seconds). Returns { success, digestId, storiesCount, edition }.
   *
   * Note: if today's digest for this edition is already published, returns 409 Conflict.
   */

  /**
   * GET /api/admin/digest-pin
   * Returns whether a digest PIN is configured (not the PIN itself).
   * Used by DigestView to know if PIN auth is required before generating.
   */
  app.get("/api/admin/digest-pin/status", requireApiKey, (_req, res) => {
    const pin = storage.getConfig("digest_pin");
    res.json({ configured: !!pin });
  });

  /**
   * POST /api/admin/digest-pin
   * Set or update the digest generation PIN.
   * Body: { pin: "123456" } — must be 4-8 digits.
   */
  app.post("/api/admin/digest-pin", requireApiKey, (req, res) => {
    const { pin } = req.body || {};
    if (!pin || !/^\d{4,8}$/.test(String(pin))) {
      return res.status(400).json({ error: "PIN must be 4-8 digits." });
    }
    storage.setConfig("digest_pin", String(pin));
    res.json({ success: true });
  });

  /**
   * POST /api/admin/verify-pin
   * Public endpoint — verifies the digest generation PIN without the admin key.
   * Returns { valid: true/false }. Rate-limiting is handled by the 3-attempt
   * lockout in the client (PinKeypad component).
   * Body: { pin: "123456" }
   */
  app.post("/api/admin/verify-pin", (req, res) => {
    const { pin } = req.body || {};
    const stored = storage.getConfig("digest_pin") || "123456"; // default PIN
    const valid = String(pin) === stored;
    res.json({ valid });
  });


  /**
   * POST /api/digest/generate-with-pin
   * Public-facing generate endpoint authenticated by the digest PIN instead of
   * the admin key. Used by the PinKeypad component in DigestView.
   *
   * Body: { pin: "123456", edition: "en" }
   *
   * Why a separate endpoint:
   *   The public reader has no admin key stored (unless user visited /#/admin).
   *   The PIN is a lightweight numeric secret specifically for reader-side generation.
   *   This endpoint verifies the PIN then runs the same pipeline as /api/digest/generate.
   *
   * Returns an immediate 202 Accepted and runs the pipeline async so the client
   * can poll /api/digest/latest for the new digest instead of holding a 90s connection.
   * This avoids the 502 timeout problem entirely.
   */
  /**
   * ── Digest generation job system (v3.3.1) ────────────────────────────────
   *
   * Pattern: POST to start job → GET /api/digest/job/:id/stream for SSE.
   *
   * Why two steps instead of one POST-SSE:
   *   EventSource (the browser's native SSE API) only supports GET.
   *   fetch() + ReadableStream for SSE works in Node/curl but browsers buffer
   *   the response body until the connection closes — the progress events
   *   arrive all at once at the end, making the UI appear frozen.
   *   Using a real GET EventSource fixes the buffering issue completely.
   *
   * Job lifecycle:
   *   1. POST /api/digest/start-job  → returns { jobId }
   *   2. Browser opens EventSource to GET /api/digest/job/:id/stream
   *   3. Server streams: start → progress → heartbeat (10s) → done|error
   *   4. Browser closes EventSource on done|error
   */

  // In-memory job store
  const jobs = new Map<string, {
    status: "pending"|"running"|"done"|"error";
    edition: string;
    events: object[];          // full event objects — replayed to late subscribers
    result?: { digestId: number; storiesCount: number; elapsed: number };
    error?: string;
    listeners: Array<(line: string) => void>;
  }>();

  const emitJob = (jobId: string, event: object) => {
    const job = jobs.get(jobId);
    if (!job) return;
    // Store FULL event so late subscribers get the correct type + all fields
    job.events.push(event);
    const line = `data: ${JSON.stringify(event)}\n\n`;
    job.listeners.forEach(fn => fn(line));
  };

  /**
   * POST /api/digest/start-job
   * Verifies PIN, starts the pipeline in the background, returns jobId.
   */
  app.post("/api/digest/start-job", async (req, res) => {
    const { pin, edition: editionId = "en" } = req.body || {};

    const storedPin = storage.getConfig("digest_pin") || "123456";
    if (String(pin) !== storedPin) {
      return res.status(401).json({ error: "Invalid PIN." });
    }
    const apiKey = storage.getConfig("openrouter_key");
    if (!apiKey) {
      return res.status(400).json({ error: "OpenRouter API key not configured." });
    }

    // Create job
    const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    jobs.set(jobId, { status: "pending", edition: editionId, events: [], listeners: [] });

    // Return jobId immediately
    res.json({ jobId, edition: editionId });

    // Run pipeline in background
    const job = jobs.get(jobId)!;
    job.status = "running";
    const startMs = Date.now();
    const elapsed = () => Math.floor((Date.now() - startMs) / 1000);

    emitJob(jobId, { type: "start", edition: editionId });

    // Auto-unpublish existing published digest for today
    const today = new Date().toISOString().slice(0, 10);
    const existing = storage.getDigestByDate(today, editionId);
    if (existing?.status === "published") {
      emitJob(jobId, { type: "progress", step: 1, total: 5, message: "Unpublishing existing digest to allow regeneration…", elapsed: elapsed() });
      storage.updateDigest(existing.id, { status: "draft", publishedAt: null });
    }

    emitJob(jobId, { type: "progress", step: 2, total: 5, message: "Fetching 50+ RSS sources across the web…", elapsed: elapsed() });

    try {
      // Heartbeat interval
      const hb = setInterval(() => emitJob(jobId, { type: "heartbeat" }), 10_000);

      emitJob(jobId, { type: "progress", step: 3, total: 5, message: "Running Gemini 2.5 Pro — selecting 20 stories…", elapsed: elapsed() });

      // 5-minute overall timeout — prevents truly infinite hangs while giving
      // Gemini 2.5 Pro enough time even under load (observed: up to 4 min for FR)
      const PIPELINE_TIMEOUT_MS = 5 * 60 * 1000;
      let pipelinePromise = runDailyPipeline(apiKey, editionId);
      const result = await Promise.race([
        pipelinePromise,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("TIMEOUT")), PIPELINE_TIMEOUT_MS)
        ),
      ]) as Awaited<ReturnType<typeof runDailyPipeline>>;
      clearInterval(hb);

      emitJob(jobId, { type: "progress", step: 4, total: 5, message: `AI selected ${result.storiesCount} stories. Publishing…`, elapsed: elapsed() });

      storage.updateDigest(result.digestId, {
        status: "published",
        publishedAt: new Date().toISOString(),
      });

      const elapsedFinal = elapsed();
      job.status = "done";
      job.result = { digestId: result.digestId, storiesCount: result.storiesCount, elapsed: elapsedFinal };
      emitJob(jobId, { type: "progress", step: 5, total: 5, message: "Published!", elapsed: elapsedFinal });
      emitJob(jobId, { type: "done", digestId: result.digestId, storiesCount: result.storiesCount, elapsed: elapsedFinal });

      console.log(`[job ${jobId}] ${editionId} done in ${elapsedFinal}s — digest #${result.digestId}`);

    } catch (err: any) {
      const msg = err?.message || "Unknown error";

      if (msg === "TIMEOUT") {
        // Timed out — but pipeline may still complete in background.
        // Wait 45s then check the DB for a newly created digest.
        emitJob(jobId, { type: "progress", step: 4, total: 5,
          message: "Taking longer than expected — checking result…", elapsed: elapsed() });
        await new Promise(r => setTimeout(r, 45_000));

        const today2 = new Date().toISOString().slice(0, 10);
        const created = storage.getDigestByDate(today2, editionId);
        if (created) {
          if (created.status !== "published") {
            storage.updateDigest(created.id, {
              status: "published", publishedAt: new Date().toISOString()
            });
          }
          const elapsedFinal2 = elapsed();
          const storiesCount = JSON.parse(created.storiesJson || "[]").length;
          job.status = "done";
          job.result = { digestId: created.id, storiesCount, elapsed: elapsedFinal2 };
          emitJob(jobId, { type: "progress", step: 5, total: 5, message: "Published!", elapsed: elapsedFinal2 });
          emitJob(jobId, { type: "done", digestId: created.id, storiesCount, elapsed: elapsedFinal2 });
          console.log(`[job ${jobId}] ${editionId} recovered after timeout — digest #${created.id}, ${storiesCount} stories`);
        } else {
          job.status = "error";
          job.error = "Timed out after 5 min. Try refreshing — generation may have completed.";
          emitJob(jobId, { type: "error", message: job.error, elapsed: elapsed() });
          console.error(`[job ${jobId}] ${editionId} timed out with no digest in DB`);
        }
      } else {
        job.status = "error";
        job.error = msg;
        emitJob(jobId, { type: "error", message: msg, elapsed: elapsed() });
        console.error(`[job ${jobId}] ${editionId} failed:`, msg);
      }
    } finally {
      // Clean up job after 10 minutes (longer to allow timeout recovery)
      setTimeout(() => jobs.delete(jobId), 600_000);
    }
  });

  /**
   * GET /api/digest/job/:id/stream
   * SSE stream for a running job. Replays any missed events, then streams live.
   * Client uses: new EventSource("/api/digest/job/JOB_ID/stream")
   */
  app.get("/api/digest/job/:id/stream", (req, res) => {
    const jobId = req.params.id;
    const job = jobs.get(jobId);
    if (!job) {
      return res.status(404).json({ error: "Job not found." });
    }

    // SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const write = (line: string) => { try { res.write(line); } catch {} };

    // Replay ALL stored events so late subscribers catch up with full fidelity
    // This ensures step/total/done fields arrive even if EventSource connects late
    job.events.forEach(evt => write(`data: ${JSON.stringify(evt)}\n\n`));

    // If already done/error, send terminal event and close
    if (job.status === "done" && job.result) {
      write(`data: ${JSON.stringify({ type: "done", ...job.result })}\n\n`);
      res.end(); return;
    }
    if (job.status === "error") {
      write(`data: ${JSON.stringify({ type: "error", message: job.error })}\n\n`);
      res.end(); return;
    }

    // Live: register listener
    job.listeners.push(write);

    // Clean up on client disconnect
    req.on("close", () => {
      const idx = job.listeners.indexOf(write);
      if (idx !== -1) job.listeners.splice(idx, 1);
    });
  });


  /**
   * GET /api/digest/job/:id/status
   * Simple JSON status check — used as a polling fallback when EventSource drops.
   * Returns { status, result?, error? }
   */
  app.get("/api/digest/job/:id/status", (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: "Job not found." });
    res.json({
      status: job.status,
      edition: job.edition,
      result: job.result,
      error: job.error,
    });
  });

  /**
   * POST /api/digest/generate-with-pin  (v3.3.1 — legacy compat, now uses jobs)
   * Kept for backwards compatibility. Forwards to start-job + streams response.
   */
  app.post("/api/digest/generate-with-pin", async (req, res) => {
    const { pin, edition: editionId = "en" } = req.body || {};
    const storedPin = storage.getConfig("digest_pin") || "123456";
    if (String(pin) !== storedPin) {
      return res.status(401).json({ error: "Invalid PIN." });
    }
    // Just delegate to start-job concept
    res.json({ success: true, message: "Use /api/digest/start-job instead", edition: editionId });
  });

    app.post("/api/digest/generate", requireApiKey, async (req, res) => {
    const apiKey = storage.getConfig("openrouter_key");
    if (!apiKey) {
      return res.status(400).json({
        error: "OpenRouter API key not configured. Visit /#/setup to configure.",
      });
    }

    const edition = (req.body?.edition as string) || "en";

    // Auto-unpublish existing published digest for today so we can regenerate
    // without requiring the user to manually unpublish first (v3.3.0)
    const today = new Date().toISOString().slice(0, 10);
    const existing = storage.getDigestByDate(today, edition);
    if (existing?.status === "published") {
      console.log(`[generate] Auto-unpublishing ${edition} digest #${existing.id} for re-generation`);
      storage.updateDigest(existing.id, { status: "draft", publishedAt: null });
    }

    // ── Request-level timeout guard (v3.2.5) ──────────────────────────────
    // The pipeline can take 30-90s. Without an explicit socket timeout,
    // Fly.io's proxy drops the connection at 75s and the client sees a 502.
    //
    // We set the socket timeout to 170s for this specific request only —
    // long enough for any pipeline run, short enough to surface real hangs.
    // On timeout we send a 504 Gateway Timeout so the client gets a meaningful
    // error instead of a bare connection reset.
    //
    // Note: req.socket.setTimeout() only affects THIS request's socket idle
    // timeout, not the global server keepAliveTimeout. Both are needed:
    //   - keepAliveTimeout: keeps the persistent connection alive between reqs
    //   - socket.setTimeout here: guards the long-poll for generate specifically
    req.socket?.setTimeout(170_000);
    res.setTimeout(170_000, () => {
      if (!res.headersSent) {
        res.status(504).json({
          error: "Digest generation timed out (170s). The server is still running — try again in a moment.",
        });
      }
    });

    try {
      const result = await runDailyPipeline(apiKey, edition);
      if (!res.headersSent) {
        res.json({ success: true, ...result });
      }
    } catch (e: any) {
      if (!res.headersSent) {
        const statusCode = e.message?.includes("already exists") ? 409 : 500;
        res.status(statusCode).json({ error: e.message });
      }
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

  // ── Editorial Prompt ──────────────────────────────────────────────────────

  /**
   * GET /api/admin/editorial-prompt
   * Admin. Returns the current editorial prompt (user's interest/personality config).
   * Empty string if not set.
   *
   * The editorial prompt is injected into the AI system prompt at generation time,
   * telling the model who the reader is and what they care about.
   */
  app.get("/api/admin/editorial-prompt", requireApiKey, (_req, res) => {
    const prompt = storage.getConfig("editorial_prompt") || "";
    res.json({ prompt });
  });

  /**
   * POST /api/admin/editorial-prompt
   * Admin. Save or update the editorial prompt.
   * Body: { prompt: string } — max 2000 chars
   *
   * Example prompt:
   *   "I'm a tech entrepreneur in Lisbon interested in AI, European startups,
   *    geopolitics, and climate tech. I prefer analytical takes over breaking news.
   *    Avoid sports, celebrity gossip, and US domestic politics unless globally significant."
   */
  app.post("/api/admin/editorial-prompt", requireApiKey, (req, res) => {
    const { prompt } = req.body || {};
    if (typeof prompt !== "string") {
      return res.status(400).json({ error: "prompt must be a string" });
    }
    if (prompt.length > 2000) {
      return res.status(400).json({ error: "prompt must be under 2000 characters" });
    }
    storage.setConfig("editorial_prompt", prompt.trim());
    res.json({ success: true, prompt: prompt.trim() });
  });

  /**
   * DELETE /api/admin/editorial-prompt
   * Admin. Clear the editorial prompt — resets to neutral AI selection.
   */
  app.delete("/api/admin/editorial-prompt", requireApiKey, (_req, res) => {
    storage.setConfig("editorial_prompt", "");
    res.json({ success: true, message: "Editorial prompt cleared." });
  });

  // ── Digest reorder ─────────────────────────────────────────────────────────

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
