import express, { type Express } from "express";
import fs from "fs";
import path from "path";

/**
 * @file server/static.ts
 * @author Paul Fleury <hello@paulfleury.com>
 * @version 3.5.1
 *
 * Static file serving + SPA hash-route redirects.
 *
 * This app uses hash-based routing (wouter useHashLocation):
 *   /#/         → DigestView (reader)
 *   /#/admin    → AdminPage
 *   /#/setup    → SetupPage
 *
 * Problem: users sharing or bookmarking https://app.cupof.news/admin
 * (without the #) land on the home page because the hash is absent.
 * The server returns index.html, React loads, but useHashLocation sees
 * no hash fragment and renders the default route (DigestView).
 *
 * Fix: server-side 301 redirects for known non-hash paths —
 *   /admin  → /#/admin
 *   /setup  → /#/setup
 *
 * API routes (/api/*) are never redirected — Express handles those first.
 */
export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  // Redirect non-hash app routes to their hash equivalents.
  // Must be registered BEFORE express.static so they take priority.
  const hashRoutes: Record<string, string> = {
    "/admin": "/#/admin",
    "/setup": "/#/setup",
  };
  for (const [from, to] of Object.entries(hashRoutes)) {
    app.get(from, (_req, res) => res.redirect(301, to));
  }

  // Cache headers strategy (v3.4.7):
  //
  // Hashed assets (JS/CSS bundles from Vite — e.g. index-CQTrQ_zc.js):
  //   max-age=31536000, immutable — 1 year, browser never re-fetches
  //   Vite changes the filename hash when content changes, so this is safe.
  //
  // index.html (the SPA entry point):
  //   no-cache — browser always revalidates (ETag / Last-Modified).
  //   This ensures users always get the latest app after a deploy.
  //
  // Other static assets (fonts, icons):
  //   max-age=86400 — 1 day cache, reasonable for non-hashed assets.
  //
  // Cloudflare will also cache /assets/* at the CDN edge (Cache Rule: 1 hour).
  // The immutable directive tells Cloudflare: never bother revalidating hashed assets.

  app.use("/assets", express.static(path.join(distPath, "assets"), {
    maxAge: "1y",
    immutable: true,
    etag: false,
    setHeaders: (res) => {
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    },
  }));

  // index.html — always revalidate (SPA entry point changes on every deploy)
  app.get("/", (_req, res) => {
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.sendFile(path.resolve(distPath, "index.html"));
  });

  // Everything else (service worker, manifest, favicon)
  app.use(express.static(distPath, {
    maxAge: "1d",
    etag: true,
  }));

  // Fall through to index.html for all other paths (SPA catch-all)
  app.use("/{*path}", (_req, res) => {
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
