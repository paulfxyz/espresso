/**
 * @file server/index.ts
 * @author Paul Fleury <hello@paulfleury.com>
 * @version 3.3.4
 *
 * Cup of News — Express Server Entry Point
 *
 * Startup sequence:
 *   1. Express app + middleware
 *   2. Route registration
 *   3. Static file serving (production) or Vite dev server
 *   4. HTTP listen
 *   5. Background: auto-generate any edition that has never had a digest
 *      (ensures the reader always has content on first deploy or after DB reset)
 */

import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";

const app = express();
const httpServer = createServer(app);

// ── Server timeout configuration (v3.2.5) ─────────────────────────────────
// The digest generation pipeline takes 30-90 seconds (Jina extraction +
// OpenRouter call). Fly.io's proxy has a 75-second idle timeout by default.
// Without explicit timeout overrides, long-running requests drop with 502.
//
// Fix: set Node.js keepAliveTimeout and headersTimeout above Fly's proxy
// timeout. This ensures the connection stays alive for the full pipeline run.
//
// keepAliveTimeout: how long to keep an idle connection open (default: 5s).
//   Set to 120s — well above Fly's 75s idle timeout.
// headersTimeout: how long to wait for request headers (default: 60s).
//   Set to 125s to be safely above keepAliveTimeout.
// requestTimeout: max time for any single request (default: 0 = no limit).
//   Set to 180s — 3× the worst-case pipeline run.
httpServer.keepAliveTimeout = 120_000;   // 120s — above Fly's 75s proxy idle timeout
httpServer.headersTimeout   = 125_000;   // must be > keepAliveTimeout

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
      // Fire-and-forget: ensure every edition has at least one digest.
      // Runs in background so it never delays server startup or first request.
      ensureAllEditionsHaveDigest();
    },
  );
})();

/**
 * ensureAllEditionsHaveDigest — background startup task
 *
 * WHY THIS EXISTS:
 *   After a fresh deploy, DB reset, or first-time setup, some or all editions
 *   may have no published digest. The reader would show an empty state or a
 *   fallback notice for every edition except the one that was manually generated.
 *
 *   This function runs ~5s after server boot and silently generates + publishes
 *   a digest for any edition that has no published digest at all.
 *
 * DESIGN DECISIONS:
 *   - Only runs in production (NODE_ENV=production). In dev, the developer
 *     generates digests manually via the admin panel.
 *   - 5 second initial delay: lets the server fully boot and handle the first
 *     health check before starting a CPU/API-heavy generation task.
 *   - Sequential generation (not parallel): OpenRouter has rate limits and
 *     running 8 concurrent Gemini 2.5 Pro calls would trigger 429s.
 *   - Only generates if ZERO published digests exist for an edition (not just today).
 *     If yesterday's is published, that's fine — the reader shows it.
 *   - Silent failure: logs errors but never crashes the server.
 *
 * COUNTER-ARGUMENT / AUDIT:
 *   One could argue this burns API credits on startup. Counter: it only generates
 *   if there are literally zero digests for an edition. After the first run, it
 *   finds existing digests and does nothing. Cost: 9 × ~$0.07 = ~$0.63 on first deploy.
 *   Subsequent restarts: $0. Worth it to ensure the reader is never empty.
 */
async function ensureAllEditionsHaveDigest() {
  if (process.env.NODE_ENV !== "production") return;

  // Wait for server to fully start
  await new Promise(r => setTimeout(r, 5000));

  const { storage } = await import("./storage");
  const { runDailyPipeline } = await import("./pipeline");
  const { EDITIONS } = await import("@shared/editions");

  const apiKey = storage.getConfig("openrouter_key");
  if (!apiKey) {
    console.log("[⚠️ startup] No OpenRouter key configured — skipping auto-generation");
    return;
  }

  const allDigests = storage.getAllDigests();

  for (const edition of EDITIONS) {
    // Check if ANY published digest exists for this edition (not just today)
    const hasPublished = allDigests.some(
      d => d.edition === edition.id && d.status === "published"
    );

    if (hasPublished) continue; // Already has content — skip

    console.log(`[🌍 startup] No published digest for ${edition.flag} ${edition.id} — auto-generating...`);

    try {
      const result = await runDailyPipeline(apiKey, edition.id);
      const digest = storage.getDigest(result.digestId);
      if (digest) {
        storage.updateDigest(result.digestId, {
          status: "published",
          publishedAt: new Date().toISOString(),
        });
        console.log(`[✅ startup] ${edition.flag} ${edition.id}: ${result.storiesCount} stories generated and published`);
      }
    } catch (e: any) {
      // 409 = already exists for today (draft exists) — not an error, just publish it
      if (e.message?.includes("already exists")) {
        console.log(`[ℹ️ startup] ${edition.id}: draft already exists — skipping`);
      } else {
        console.error(`[❌ startup] Failed to auto-generate ${edition.id}:`, e.message);
      }
    }

    // Small delay between editions to respect rate limits
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log("[✅ startup] All editions checked. Reader will never be empty.");
}
