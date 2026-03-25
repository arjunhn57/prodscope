"use strict";

/**
 * queue.js — Simple in-process job queue
 *
 * Decouples HTTP request handling from job processing. Jobs are enqueued
 * and processed one at a time in the background (single emulator constraint).
 * State is persisted in SQLite via store.js, so pending jobs survive restarts.
 *
 * No external dependencies (no Redis, no BullMQ). When parallel emulators
 * are needed later, swap this for BullMQ with minimal interface change.
 */

const store = require("./store");
const { processJob } = require("./runner");

// -------------------------------------------------------------------------
// Queue state
// -------------------------------------------------------------------------

const pending = [];      // { jobId, apkPath, opts }
let processing = false;  // true while a job is running
let currentJobId = null;

// -------------------------------------------------------------------------
// Public API
// -------------------------------------------------------------------------

/**
 * Add a job to the queue. If nothing is running, starts processing immediately.
 * @param {string} jobId
 * @param {string} apkPath
 * @param {object} opts - { email, credentials, goldenPath, painPoints, goals }
 */
function enqueue(jobId, apkPath, opts) {
  pending.push({ jobId, apkPath, opts });
  console.log(`[queue] Enqueued job ${jobId} (queue depth: ${pending.length})`);
  drain();
}

/**
 * Get queue status for API consumers.
 */
function status() {
  return {
    processing,
    currentJobId,
    queueDepth: pending.length,
    pendingJobIds: pending.map((j) => j.jobId),
  };
}

/**
 * Get position of a job in the queue (0 = currently processing, 1+ = waiting).
 * Returns -1 if job is not in the queue (already completed or unknown).
 */
function position(jobId) {
  if (currentJobId === jobId) return 0;
  const idx = pending.findIndex((j) => j.jobId === jobId);
  return idx === -1 ? -1 : idx + 1;
}

// -------------------------------------------------------------------------
// Internal: drain loop
// -------------------------------------------------------------------------

async function drain() {
  if (processing) return; // already running a job
  if (pending.length === 0) return;

  const { jobId, apkPath, opts } = pending.shift();
  processing = true;
  currentJobId = jobId;

  console.log(`[queue] Starting job ${jobId} (${pending.length} remaining)`);

  try {
    await processJob(jobId, apkPath, opts);
  } catch (err) {
    console.error(`[queue] Job ${jobId} threw unhandled error:`, err.message);
    try {
      store.updateJob(jobId, { status: "failed", error: err.message });
    } catch (_) {}
  } finally {
    processing = false;
    currentJobId = null;
    // Process next job if any
    drain();
  }
}

// -------------------------------------------------------------------------
// Startup recovery: re-enqueue jobs that were "processing" when server died
// -------------------------------------------------------------------------

function recoverPendingJobs() {
  try {
    const db = store.db;
    const stuck = db
      .prepare("SELECT id, data FROM jobs WHERE status = 'queued' OR status = 'processing' ORDER BY created_at ASC")
      .all();

    if (stuck.length === 0) return;

    console.log(`[queue] Recovering ${stuck.length} pending/stuck job(s) from database`);

    for (const row of stuck) {
      const data = JSON.parse(row.data || "{}");
      // Mark as queued again (was stuck mid-processing)
      store.updateJob(row.id, { status: "queued", step: 0 });

      // We don't have the APK path anymore — mark as failed
      // In production, APKs should be stored durably (not /tmp)
      console.log(`[queue] Job ${row.id} was interrupted — marked as failed (APK lost on restart)`);
      store.updateJob(row.id, {
        status: "failed",
        error: "Server restarted while job was in progress. APK file no longer available. Please resubmit.",
      });
    }
  } catch (e) {
    console.error("[queue] Recovery scan failed:", e.message);
  }
}

module.exports = { enqueue, status, position, recoverPendingJobs };
