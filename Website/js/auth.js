// js/auth.js
//
// WebNail auth/billing layer. Loaded as a module by the website.
// Fill in SUPABASE_URL / SUPABASE_ANON_KEY below with your project's values
// (Project Settings → API in the Supabase dashboard). The anon key is
// public-safe by design — it only works within the RLS policies defined in
// supabase/migrations/001_init.sql.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

// ── Fill these in ────────────────────────────────────────────────
const SUPABASE_URL = "https://YOUR-PROJECT-REF.supabase.co";
const SUPABASE_ANON_KEY = "YOUR-SUPABASE-ANON-KEY";
const EDGE_FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;
// ─────────────────────────────────────────────────────────────────

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const listeners = new Set();
let state = {
  session: null,
  profile: null,   // { email, free_generations_used, free_generations_limit, is_unlimited, api_key }
  loading: true,
};

function setState(patch) {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn(state));
}

export function onAuthStateChange(fn) {
  listeners.add(fn);
  fn(state); // fire immediately with current state
  return () => listeners.delete(fn);
}

export function getState() {
  return state;
}

async function loadProfile(userId) {
  const { data, error } = await supabase
    .from("profiles")
    .select("email, free_generations_used, free_generations_limit, is_unlimited, api_key, subscription_status")
    .eq("id", userId)
    .single();
  if (error) {
    console.error("Failed to load profile:", error);
    return null;
  }
  return data;
}

async function refreshSession() {
  const { data } = await supabase.auth.getSession();
  const session = data.session ?? null;
  let profile = null;
  if (session) profile = await loadProfile(session.user.id);
  setState({ session, profile, loading: false });
  // keep the extension's popup in sync if it's installed (no-op elsewhere)
  syncToExtension(session, profile);
}

supabase.auth.onAuthStateChange(async (_event, session) => {
  let profile = null;
  if (session) profile = await loadProfile(session.user.id);
  setState({ session, profile, loading: false });
  syncToExtension(session, profile);
});

refreshSession();

// ── Public API ──────────────────────────────────────────────────

export async function signUp(email, password) {
  const { error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
}

export async function signIn(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function signInWithGoogle() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: window.location.origin },
  });
  if (error) throw error;
}

export async function signOut() {
  await supabase.auth.signOut();
}

export async function refreshProfile() {
  if (!state.session) return null;
  const profile = await loadProfile(state.session.user.id);
  setState({ profile });
  syncToExtension(state.session, profile);
  return profile;
}

/**
 * Call before/around a generation. Atomically checks + burns one free
 * generation (or no-ops the quota check if the account is unlimited) via
 * the record_generation() RPC, so two tabs can't race past the free limit.
 * Returns { allowed, remaining, isUnlimited }.
 */
export async function recordGeneration({ sourceType, sourceLabel, outputFormat = "html" }) {
  if (!state.session) {
    return { allowed: false, remaining: 0, isUnlimited: false, reason: "signed_out" };
  }
  const { data, error } = await supabase.rpc("record_generation", {
    p_source_type: sourceType,
    p_source_label: sourceLabel,
    p_output_format: outputFormat,
  });
  if (error) {
    console.error("record_generation failed:", error);
    return { allowed: false, remaining: 0, isUnlimited: false, reason: "error" };
  }
  const row = data?.[0];
  await refreshProfile();
  if (!row) return { allowed: false, remaining: 0, isUnlimited: false, reason: "error" };
  return {
    allowed: row.allowed,
    remaining: row.remaining,
    isUnlimited: row.is_unlimited,
    reason: row.allowed ? null : "quota_exceeded",
  };
}

/** Starts Stripe Checkout for the $5.99/mo unlimited plan. Redirects the browser. */
export async function startUpgradeCheckout() {
  if (!state.session) throw new Error("Sign in first");
  const res = await fetch(`${EDGE_FUNCTIONS_URL}/create-checkout-session`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${state.session.access_token}`,
    },
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || "Could not start checkout");
  window.location.href = body.url;
}

/** Issues (or returns the existing) API key. Only succeeds once is_unlimited is true. */
export async function ensureApiKey() {
  const { data, error } = await supabase.rpc("ensure_api_key");
  if (error) throw error;
  await refreshProfile();
  return data;
}

export function remainingFreeGenerations() {
  if (!state.profile) return 0;
  if (state.profile.is_unlimited) return Infinity;
  return Math.max(0, state.profile.free_generations_limit - state.profile.free_generations_used);
}

// ── Extension bridge ────────────────────────────────────────────
// If the WebNail extension is installed, mirror auth state into
// chrome.storage-adjacent localStorage under a namespaced key so its
// content script / popup (running on this site) can pick it up via a
// postMessage the extension listens for. This is optional and no-ops
// silently when the extension isn't present.
function syncToExtension(session, profile) {
  try {
    window.postMessage(
      {
        source: "webnail-website",
        type: "WEBNAIL_AUTH_STATE",
        payload: {
          signedIn: !!session,
          email: session?.user?.email ?? null,
          isUnlimited: profile?.is_unlimited ?? false,
          remaining: profile
            ? profile.is_unlimited
              ? -1
              : Math.max(0, profile.free_generations_limit - profile.free_generations_used)
            : 0,
        },
      },
      window.location.origin
    );
  } catch {
    /* no-op */
  }
}
