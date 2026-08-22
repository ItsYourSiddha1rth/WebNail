// js/generate.js
//
// Talks to the WebNail generation server (Render, Ollama llava:13b under the
// hood). Two calls: POST to start a job, then poll GET until it's done.
// llava:13b on CPU is slow, so polling backs off rather than hammering the
// server every 500ms.

// Fill this in with your Render service URL, e.g. "https://webnail-server.onrender.com"
export const API_BASE = "https://YOUR-RENDER-SERVICE.onrender.com";

const POLL_INTERVALS_MS = [1500, 1500, 2000, 2000, 3000, 3000, 5000]; // then settle at 5s
const MAX_POLL_MS = 5 * 60 * 1000; // give up after 5 minutes

class GenerationError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

function authHeaders(session) {
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
}

/**
 * Generate code from an uploaded screenshot file.
 * @returns {Promise<{code: string, format: string}>}
 */
export async function generateFromImage({ file, format, session, onStatus }) {
  const form = new FormData();
  form.append("image", file);
  form.append("format", format);
  form.append("sourceType", "upload");
  form.append("sourceLabel", file.name);

  const res = await fetch(`${API_BASE}/api/generate`, {
    method: "POST",
    headers: authHeaders(session),
    body: form,
  });

  return startAndPoll(res, session, onStatus);
}

/**
 * Generate code from a fetched page's HTML (link mode).
 * @returns {Promise<{code: string, format: string}>}
 */
export async function generateFromMarkup({ sourceHtml, sourceLabel, format, session, onStatus }) {
  const res = await fetch(`${API_BASE}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(session) },
    body: JSON.stringify({ sourceHtml, sourceLabel, format, sourceType: "link" }),
  });

  return startAndPoll(res, session, onStatus);
}

async function startAndPoll(startRes, session, onStatus) {
  if (startRes.status === 402) {
    const body = await startRes.json().catch(() => ({}));
    throw new GenerationError(body.error || "Free generation limit reached.", "QUOTA_EXCEEDED");
  }
  if (!startRes.ok) {
    const body = await startRes.json().catch(() => ({}));
    throw new GenerationError(body.error || `Request failed (${startRes.status})`, "START_FAILED");
  }

  const { jobId } = await startRes.json();
  onStatus?.("Generating — this can take a minute or two…");

  const startedAt = Date.now();
  let attempt = 0;

  while (Date.now() - startedAt < MAX_POLL_MS) {
    const wait = POLL_INTERVALS_MS[Math.min(attempt, POLL_INTERVALS_MS.length - 1)];
    await sleep(wait);
    attempt++;

    const res = await fetch(`${API_BASE}/api/generate/${jobId}`, {
      headers: authHeaders(session),
    });

    if (res.status === 404) {
      throw new GenerationError("The generation job expired. Please try again.", "JOB_EXPIRED");
    }
    if (!res.ok) {
      throw new GenerationError(`Couldn't check job status (${res.status})`, "POLL_FAILED");
    }

    const job = await res.json();
    if (job.status === "done") {
      return job.result; // { code, format }
    }
    if (job.status === "error") {
      throw new GenerationError(job.error || "Generation failed.", "GENERATION_FAILED");
    }
    // otherwise still "pending" / "running" — keep polling
  }

  throw new GenerationError("Generation is taking longer than expected. Please try again.", "TIMEOUT");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export { GenerationError };
