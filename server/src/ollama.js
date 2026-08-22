// src/ollama.js
//
// Talks to the local Ollama daemon (same container, localhost:11434).
// Uses llava:13b by default — override with the WEBNAIL_MODEL env var.

import fetch from "node-fetch";

const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const MODEL = process.env.WEBNAIL_MODEL || "llava:13b";

const SYSTEM_PROMPT = `You are WebNail, a tool that converts screenshots of web pages or UI components into clean, production-ready code.

Rules:
- Output ONLY code. No explanation, no markdown fences, no commentary before or after.
- Match the layout, spacing, colors, and text you see in the image as closely as possible.
- Use semantic HTML and plain CSS (in a <style> tag) unless the user asked for React.
- Prefer flexbox/grid over absolute positioning.
- If the requested format is "react", output a single functional component using inline Tailwind-style utility classes, default export, no external assets.
- If you cannot make out some detail, make a reasonable design decision rather than leaving a gap or placeholder comment.`;

/**
 * Generate code from a base64-encoded image.
 * @param {object} opts
 * @param {string} opts.imageBase64 - raw base64 (no "data:image/..." prefix)
 * @param {"html"|"react"} opts.format
 * @param {string} [opts.extraInstructions] - optional user notes
 * @returns {Promise<string>} generated code
 */
export async function generateCodeFromImage({ imageBase64, format = "html", extraInstructions = "" }) {
  const formatLine =
    format === "react"
      ? "Output format: a single React functional component (JSX), default export, Tailwind utility classes for styling."
      : "Output format: a single HTML file with an inline <style> block.";

  const prompt = [
    SYSTEM_PROMPT,
    formatLine,
    extraInstructions ? `Additional instructions from the user: ${extraInstructions}` : "",
    "Now generate the code for the attached screenshot.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      prompt,
      images: [imageBase64],
      stream: false,
      options: {
        temperature: 0.2, // low temp — we want faithful reproduction, not creativity
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Ollama request failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  return cleanCodeOutput(data.response || "");
}

/**
 * Text-only variant, used for link/HTML-source mode: pass along the fetched
 * page's HTML/text content and ask the model to produce a cleaned-up version,
 * since llava is multimodal but works fine with text-only prompts too.
 */
export async function generateCodeFromMarkup({ sourceHtml, format = "html", extraInstructions = "" }) {
  const formatLine =
    format === "react"
      ? "Output format: a single React functional component (JSX), default export, Tailwind utility classes for styling."
      : "Output format: a single HTML file with an inline <style> block.";

  const prompt = [
    SYSTEM_PROMPT,
    formatLine,
    extraInstructions ? `Additional instructions from the user: ${extraInstructions}` : "",
    "Rebuild the following page as clean, minimal code preserving its visible structure and content:",
    "```html",
    sourceHtml.slice(0, 20000), // keep prompt bounded
    "```",
  ]
    .filter(Boolean)
    .join("\n\n");

  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      prompt,
      stream: false,
      options: { temperature: 0.2 },
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Ollama request failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  return cleanCodeOutput(data.response || "");
}

function cleanCodeOutput(raw) {
  // Vision-language models often wrap output in markdown fences despite
  // instructions not to — strip them defensively.
  let out = raw.trim();
  out = out.replace(/^```[a-zA-Z]*\n?/, "").replace(/```$/, "");
  return out.trim();
}

export async function checkOllamaHealth() {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`);
    if (!res.ok) return { ok: false, error: `status ${res.status}` };
    const data = await res.json();
    const hasModel = (data.models || []).some((m) => m.name === MODEL || m.name.startsWith(MODEL.split(":")[0]));
    return { ok: true, model: MODEL, modelPulled: hasModel };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
