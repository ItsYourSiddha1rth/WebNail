// src/auth.js
//
// Verifies the caller (either a Supabase user JWT from the website, or a
// WebNail API key from an external/unlimited caller), and enforces the
// free-tier quota via the same record_generation() RPC used client-side —
// so the limit can't be bypassed by calling this API directly.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.warn(
    "[auth] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — requests will fail auth until configured."
  );
}

// Service-role client: bypasses RLS, used only for the specific lookups below.
const supabaseAdmin =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) : null;

/**
 * Resolves the caller from either:
 *   Authorization: Bearer <supabase-access-token>   (website, signed-in user)
 *   x-api-key: wn_live_...                          (unlimited-tier external API access)
 * Returns { userId, isApiKey } or throws.
 */
export async function resolveCaller(req) {
  if (!supabaseAdmin) throw new Error("Server auth not configured");

  const apiKey = req.headers["x-api-key"];
  if (apiKey) {
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("id, is_unlimited")
      .eq("api_key", apiKey)
      .single();
    if (error || !data) throw new Error("Invalid API key");
    if (!data.is_unlimited) throw new Error("API key is no longer active");
    return { userId: data.id, isApiKey: true };
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    throw new Error("Missing Authorization header or x-api-key");
  }
  const token = authHeader.slice("Bearer ".length);

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) throw new Error("Invalid session");
  return { userId: data.user.id, isApiKey: false };
}

/**
 * Burns one free generation (or passes through if unlimited) via the same
 * RPC the client uses. Server-side call uses the service-role client acting
 * "as" the resolved user by calling the RPC with an impersonated context —
 * since record_generation() is security definer and reads auth.uid(), we
 * instead call it through a per-request client authenticated with the
 * caller's own JWT when available, or fall straight through for API-key
 * calls (already gated on is_unlimited above).
 */
export async function checkAndRecordQuota({ req, userId, isApiKey, sourceType, sourceLabel, outputFormat }) {
  if (isApiKey) {
    // API-key callers are already confirmed unlimited in resolveCaller().
    // Still log the generation for their own usage history.
    await supabaseAdmin
      .from("generations")
      .insert({ user_id: userId, source_type: sourceType, source_label: sourceLabel, output_format: outputFormat });
    return { allowed: true, remaining: -1, isUnlimited: true };
  }

  const authHeader = req.headers.authorization;
  const token = authHeader.slice("Bearer ".length);
  const supabaseAsUser = createClient(SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data, error } = await supabaseAsUser.rpc("record_generation", {
    p_source_type: sourceType,
    p_source_label: sourceLabel,
    p_output_format: outputFormat,
  });

  if (error) throw error;
  const row = data?.[0];
  if (!row) return { allowed: false, remaining: 0, isUnlimited: false };
  return { allowed: row.allowed, remaining: row.remaining, isUnlimited: row.is_unlimited };
}
