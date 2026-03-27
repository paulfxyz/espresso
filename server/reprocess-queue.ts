/**
 * @file server/reprocess-queue.ts
 * @author Paul Fleury <hello@paulfleury.com>
 * @version 3.5.9
 *
 * Cup of News — In-memory Reprocess Queue with Rate Limiting
 *
 * Provides sequential background processing of digest image reprocessing jobs.
 * Only one job runs at a time (mutex). Max 2 jobs per hour (rate limit).
 * Duplicate digest IDs in the queue are detected and rejected.
 *
 * The queue is in-memory — it resets on server restart. That's fine for now.
 */

import path from "path";
import { storage } from "./storage";
import { reprocessDigestImages } from "./pipeline";
import { deleteCachedImage } from "./images";
import type { DigestStory } from "@shared/schema";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface QueueJob {
  jobId: string;
  digestId: number;
  force: boolean;
  enqueuedAt: number;
  startedAt?: number;
  completedAt?: number;
  status: "pending" | "running" | "done" | "failed";
  result?: { changed: number; total: number };
  error?: string;
}

type EnqueueResult =
  | { queued: true; position: number; jobId: string }
  | { rateLimited: true; retryAfter: number }
  | { duplicate: true; position: number };

export interface QueueStatus {
  running: QueueJob | null;
  pending: QueueJob[];
  recentHistory: QueueJob[];
  rateLimitRemaining: number;
  rateLimitResetAt: number;
}

// ─── Queue Implementation ───────────────────────────────────────────────────

class ReprocessQueue {
  private queue: QueueJob[] = [];
  private running = false;
  private history: QueueJob[] = []; // last 20 completed jobs
  private startedTimestamps: number[] = [];
  private readonly MAX_PER_HOUR = 2;

  /**
   * Enqueue a digest for reprocessing.
   * Returns queue position, rate-limit info, or duplicate notice.
   */
  enqueue(digestId: number, force = false): EnqueueResult {
    // Duplicate detection: check pending + running
    const existingIdx = this.queue.findIndex(
      (j) => j.digestId === digestId && (j.status === "pending" || j.status === "running")
    );
    if (existingIdx !== -1) {
      return { duplicate: true, position: existingIdx + 1 };
    }

    // Rate limit: filter to timestamps within last hour
    const now = Date.now();
    this.startedTimestamps = this.startedTimestamps.filter(
      (ts) => now - ts < 3600_000
    );

    if (this.startedTimestamps.length >= this.MAX_PER_HOUR) {
      const oldest = Math.min(...this.startedTimestamps);
      const retryAfter = Math.ceil((oldest + 3600_000 - now) / 1000);
      return { rateLimited: true, retryAfter };
    }

    const jobId = `rq_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const job: QueueJob = {
      jobId,
      digestId,
      force,
      enqueuedAt: now,
      status: "pending",
    };

    this.queue.push(job);
    const position = this.queue.filter(
      (j) => j.status === "pending" || j.status === "running"
    ).length;

    // Kick off processing if idle
    if (!this.running) {
      this.processNext();
    }

    return { queued: true, position, jobId };
  }

  /** Get current queue state */
  getStatus(): QueueStatus {
    const now = Date.now();
    this.startedTimestamps = this.startedTimestamps.filter(
      (ts) => now - ts < 3600_000
    );

    const runningJob = this.queue.find((j) => j.status === "running") || null;
    const pending = this.queue.filter((j) => j.status === "pending");
    const rateLimitRemaining = Math.max(
      0,
      this.MAX_PER_HOUR - this.startedTimestamps.length
    );
    const oldest = this.startedTimestamps.length > 0
      ? Math.min(...this.startedTimestamps)
      : now;
    const rateLimitResetAt = this.startedTimestamps.length > 0
      ? oldest + 3600_000
      : now;

    return {
      running: runningJob,
      pending,
      recentHistory: this.history.slice(-20),
      rateLimitRemaining,
      rateLimitResetAt,
    };
  }

  /** Process the next pending job. Sequential — one at a time. */
  private async processNext(): Promise<void> {
    const job = this.queue.find((j) => j.status === "pending");
    if (!job) {
      this.running = false;
      return;
    }

    this.running = true;
    job.status = "running";
    job.startedAt = Date.now();
    this.startedTimestamps.push(job.startedAt);

    try {
      // ── Replicate the exact logic from the POST route handler ──
      const digest = storage.getDigest(job.digestId);
      if (!digest) {
        throw new Error(`Digest #${job.digestId} not found`);
      }

      const apiKey = process.env.OPENROUTER_KEY || storage.getConfig("openrouter_key") || "";
      const stories: DigestStory[] = JSON.parse(digest.storiesJson);
      let changed = 0;

      for (const story of stories) {
        const oldUrl = story.imageUrl;

        // Force mode: delete cached file and clear imageUrl so reprocessDigestImages re-runs
        if (job.force && story.imageUrl.startsWith("/images/")) {
          const hash = path.basename(story.imageUrl, ".webp");
          deleteCachedImage(hash);
          story.imageUrl = ""; // clear so reprocessDigestImages doesn't skip it
        }

        try {
          const newUrl = await reprocessDigestImages(story, apiKey);
          story.imageUrl = newUrl;
          if (newUrl !== oldUrl) changed++;
        } catch (e: any) {
          story.imageUrl = oldUrl; // restore on error
          console.error(`[reprocess-queue] Error processing story "${story.title.slice(0, 40)}":`, e.message);
        }
      }

      // Save changes back to DB
      storage.updateDigest(digest.id, { storiesJson: JSON.stringify(stories) });

      job.status = "done";
      job.completedAt = Date.now();
      job.result = { changed, total: stories.length };

      console.log(
        `[reprocess-queue] Job ${job.jobId} done — digest #${job.digestId}: ${changed}/${stories.length} changed`
      );
    } catch (e: any) {
      job.status = "failed";
      job.completedAt = Date.now();
      job.error = e.message || "Unknown error";
      console.error(`[reprocess-queue] Job ${job.jobId} failed:`, job.error);
    } finally {
      // Move completed/failed job to history
      this.queue = this.queue.filter((j) => j.jobId !== job.jobId);
      this.history.push(job);
      if (this.history.length > 20) {
        this.history = this.history.slice(-20);
      }

      // Process next job in queue
      this.running = false;
      this.processNext();
    }
  }
}

export const reprocessQueue = new ReprocessQueue();
