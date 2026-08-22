// src/index.js
//
// WebNail generation API. Single Express app, two real endpoints:
//
//   POST /api/generate       — start a generation job, returns { jobId } immediately
//   GET  /api/generate/:id   — poll a job's status/result
//   GET  /api/health         — Ollama reachability + whether the model is pulled
//
// Auth: every /api/generate* request needs either
//   Authorization: Bearer <supabase-access-token>   (website)
//   x-api-key: wn_live_...                          (unlimited external callers)
// Free-tier accounts are metered via the same record_generation() RPC the
// client uses directly, so the quota can't be bypassed by calling this API
// straight from curl.
//
// Generation itself runs as a background job (see jobs.js) because llava:13b
// on Render's CPU-only instances routinely takes well over a minute — far
// longer than Render's HTTP proxy or a browser fetch will patiently wait.

import express from "express";
import cors from "cors";
import multer from "multer";
import fetch from "node-fetch";
import { resolveCaller, checkAndRecordQuota } from "./auth.js";
import { createJob, getJob, markRunning, markDone, markError } from "./jobs.js";
import { generateCodeFromImage, generateCodeFromMarkup, checkOllamaHealth } from "./ollama.js";

const app = express();
const upload = multer({ limits: { fileSize: 20 * 1024 * 1024 } }); // 20MB, matches the website's dropzone copy

const allowedOrigins = (process.env.ALLOWED_ORIGINS || "*")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: allowedOrigins.includes("*") ? true : allowedOrigins,
    allowedHeaders: ["Content-Type", "Authorization", "x-api-key"],
  })
);
app.use(express.json({ limit: "1mb" })); // JSON path used for link/HTML-source mode; images go via multipart

// ── health ──────────────────────────────────────────────────────
app.get("/api/health", async (_req, res) => {
  const ollama = await checkOllamaHealth();
  res.status(ollama.ok ? 200 : 503).json({ ok: ollama.ok, ollama });
});

// ── fetch a page's HTML server-side (avoids browser CORS for link mode) ──
app.get("/api/fetch-page", async (req, res) => {
  try {
    await resolveCaller(req); // require a signed-in caller, but don't burn quota just to preview-fetch
  } catch (err) {
    return res.status(401).json({ error: err.message });
  }

  const target = req.query.url;
  if (!target || typeof target !== "string") {
    return res.status(400).json({ error: "Missing url query parameter." });
  }

  let parsed;
  try {
    parsed = new URL(target);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("bad protocol");
  } catch {
    return res.status(400).json({ error: "Invalid URL." });
  }

  try {
    const pageRes = await fetch(parsed.toString(), {
      redirect: "follow",
      headers: { "User-Agent": "WebNailBot/1.0 (+https://webnail.app)" },
    });
    if (!pageRes.ok) {
      return res.status(502).json({ error: `Target site returned ${pageRes.status}` });
    }
    const html = await pageRes.text();
    res.json({ html: html.slice(0, 200_000) }); // guard against huge pages
  } catch (err) {
    res.status(502).json({ error: `Couldn't reach that page: ${err.message}` });
  }
});

// ── start a generation job ─────────────────────────────────────
// multipart/form-data: fields = format, sourceType, sourceLabel, extraInstructions; file = image
// OR application/json: { sourceHtml, format, sourceType, sourceLabel, extraInstructions }
app.post("/api/generate", upload.single("image"), async (req, res) => {
  let caller;
  try {
    caller = await resolveCaller(req);
  } catch (err) {
    return res.status(401).json({ error: err.message });
  }

  const body = req.body || {};
  const format = body.format === "react" ? "react" : "html";
  const sourceType = body.sourceType || (req.file ? "upload" : "link");
  const sourceLabel = body.sourceLabel || req.file?.originalname || "untitled";
  const extraInstructions = body.extraInstructions || "";

  if (!req.file && !body.sourceHtml) {
    return res.status(400).json({ error: "Provide either an image file or sourceHtml." });
  }

  let quota;
  try {
    quota = await checkAndRecordQuota({
      req,
      userId: caller.userId,
      isApiKey: caller.isApiKey,
      sourceType,
      sourceLabel,
      outputFormat: format,
    });
  } catch (err) {
    return res.status(500).json({ error: `Quota check failed: ${err.message}` });
  }

  if (!quota.allowed) {
    return res.status(402).json({
      error: "Free generation limit reached. Upgrade for unlimited access.",
      code: "QUOTA_EXCEEDED",
    });
  }

  const jobId = createJob();

  // Fire and forget — client polls GET /api/generate/:id for the result.
  runGenerationJob(jobId, { file: req.file, sourceHtml: body.sourceHtml, format, extraInstructions });

  res.status(202).json({ jobId, remaining: quota.remaining, isUnlimited: quota.isUnlimited });
});

async function runGenerationJob(jobId, { file, sourceHtml, format, extraInstructions }) {
  markRunning(jobId);
  try {
    let code;
    if (file) {
      const imageBase64 = file.buffer.toString("base64");
      code = await generateCodeFromImage({ imageBase64, format, extraInstructions });
    } else {
      code = await generateCodeFromMarkup({ sourceHtml, format, extraInstructions });
    }
    markDone(jobId, { code, format });
  } catch (err) {
    console.error(`[job ${jobId}] generation failed:`, err);
    markError(jobId, err.message || "Generation failed");
  }
}

// ── poll a job ──────────────────────────────────────────────────
app.get("/api/generate/:id", async (req, res) => {
  try {
    await resolveCaller(req); // polling still requires a valid caller
  } catch (err) {
    return res.status(401).json({ error: err.message });
  }

  const job = getJob(req.params.id);
  if (!job) {
    return res.status(404).json({ error: "Job not found or expired. Try generating again." });
  }
  res.json({ status: job.status, result: job.result, error: job.error });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`[webnail-server] listening on :${PORT}`);
});
