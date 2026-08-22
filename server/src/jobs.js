// src/jobs.js
//
// llava:13b on Render's CPU-only instances can take 1-3+ minutes per
// generation. Rather than hold an HTTP connection open that long (Render's
// proxy and most browsers will time out well before that), generation runs
// as a background job: POST creates it and returns immediately, the client
// polls GET /api/generate/:id until status is "done" or "error".
//
// NOTE: this store is in-memory only. If the container restarts mid-job
// (deploys, crashes, Render's free-tier idling) the job is lost — the
// client-side polling code treats a 404 after a while as "try again".
// If you outgrow this, swap the Map for a Postgres table (Supabase already
// gives you one) and this file's interface stays the same.

import { randomUUID } from "crypto";

const jobs = new Map();
const JOB_TTL_MS = 30 * 60 * 1000; // keep finished jobs around for 30 min

export function createJob() {
  const id = randomUUID();
  jobs.set(id, { id, status: "pending", result: null, error: null, createdAt: Date.now() });
  return id;
}

export function getJob(id) {
  return jobs.get(id) || null;
}

export function markRunning(id) {
  const job = jobs.get(id);
  if (job) job.status = "running";
}

export function markDone(id, result) {
  const job = jobs.get(id);
  if (job) {
    job.status = "done";
    job.result = result;
  }
}

export function markError(id, message) {
  const job = jobs.get(id);
  if (job) {
    job.status = "error";
    job.error = message;
  }
}

// Periodic sweep so the Map doesn't grow forever on a long-lived container.
setInterval(() => {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - job.createdAt > JOB_TTL_MS) jobs.delete(id);
  }
}, 5 * 60 * 1000).unref();
