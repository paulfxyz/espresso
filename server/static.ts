import express, { type Express } from "express";
import fs from "fs";
import path from "path";

/**
 * @file server/static.ts
 * @author Paul Fleury <hello@paulfleury.com>
 * @version 3.4.3
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

  app.use(express.static(distPath));

  // Fall through to index.html for all other paths (SPA catch-all)
  app.use("/{*path}", (_req, res) => {
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
