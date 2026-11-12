import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: HEADERS });

const hmacCode = async (secret: string, message: string) => {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const raw = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(raw)).map((b) => b.toString(16).padStart(2, "0")).join("");
};

const getTokenClaims = (token: string) => {
  try {
    const encoded = token.split(".")[1] ?? "";
    const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="))) as
      { aal?: string; sub?: string; exp?: number };
  } catch {
    return null;
  }
};

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: HEADERS });
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !secret || !authKey) return json({ error: "SERVER_CONFIGURATION_ERROR" }, 500);

  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return json({ error: "UNAUTHORIZED" }, 401);
  const token = authorization.slice(7);
  const claims = getTokenClaims(token);
  if (!claims || claims.aal !== "aal2" || !claims.exp ||
      claims.exp * 1000 <= Date.now()) {
    return json({ error: "ADMIN_MFA_REQUIRED" }, 403);
  }

  const authClient = createClient(url, authKey,
    { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: { user }, error: userError } = await authClient.auth.getUser(token);
  if (userError || !user || user.id !== claims.sub) return json({ error: "UNAUTHORIZED" }, 401);

  const db = createClient(url, secret,
    { auth: { autoRefreshToken: false, persistSession: false } });
  // Permanent owners only: intentionally excludes temporary / delegated staff.
  const { data: role, error: roleError } = await db.from("user_roles")
    .select("user_id").eq("user_id", user.id).eq("role", "admin").maybeSingle();
  if (roleError) return json({ error: "ROLE_CHECK_FAILED" }, 500);
  if (!role) return json({ error: "ADMIN_ONLY" }, 403);

  let body: { action?: string; targetUserId?: string; challengeId?: string };
  try { body = await request.json(); }
  catch { return json({ error: "INVALID_JSON" }, 400); }

  if (body.action === "list") {
    const { data: all, error } = await db.from("equus_device_challenges")
      .select("id,user_id,device_hash,created_at,expires_at,consumed_at")
      .gt("expires_at", new Date().toISOString())
      .is("consumed_at", null)
      .order("created_at", { ascending: false }).limit(150);
    if (error) return json({ error: "LIST_FAILED" }, 500);
    const latest = new Map<string, typeof all[number]>();
    for (const challenge of all ?? []) {
      const key = challenge.user_id + ":" + challenge.device_hash;
      if (!latest.has(key)) latest.set(key, challenge);
    }
    const candidates = [...latest.values()];
    if (!candidates.length) return json({ pending: [] });
    const ids = [...new Set(candidates.map((c) => c.user_id))];
    const { data: profiles, error: profileError } = await db.from("profiles")
      .select("id,full_name").in("id", ids);
    if (profileError) return json({ error: "PROFILE_LOOKUP_FAILED" }, 500);
    const names = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));
    return json({ pending: candidates.map((challenge) => ({
      challengeId: challenge.id,
      userId: challenge.user_id,
      name: names.get(challenge.user_id) || "Raitelis",
      createdAt: challenge.created_at,
      expiresAt: challenge.expires_at,
    })) });
  }

  if (body.action !== "generate") return json({ error: "INVALID_ACTION" }, 400);
  const targetUserId = String(body.targetUserId || "");
  const challengeId = String(body.challengeId || "");
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
  if (!uuid.test(targetUserId) || !uuid.test(challengeId)) return json({ error: "INVALID_TARGET" }, 400);

  const now = Date.now();
  const { data: challenge, error: findError } = await db.from("equus_device_challenges")
    .select("id,user_id,device_hash,expires_at,consumed_at").eq("id", challengeId)
    .eq("user_id", targetUserId).maybeSingle();
  if (findError) return json({ error: "CHALLENGE_LOOKUP_FAILED" }, 500);
  if (!challenge || challenge.consumed_at || Date.parse(challenge.expires_at) <= now) {
    return json({ error: "NO_ACTIVE_CHALLENGE" }, 409);
  }
  // Only the most recent challenge for the selected device can be replaced.
  const { data: newest, error: newestError } = await db.from("equus_device_challenges")
    .select("id").eq("user_id", targetUserId).eq("device_hash", challenge.device_hash)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (newestError || newest?.id !== challengeId) return json({ error: "CHALLENGE_REPLACED" }, 409);

  const { count, error: countError } = await db.from("equus_admin_device_code_audit")
    .select("id", { head: true, count: "exact" }).eq("target_user_id", targetUserId)
    .gte("created_at", new Date(now - 3600000).toISOString());
  if (countError) return json({ error: "RATE_CHECK_FAILED" }, 500);
  if ((count ?? 0) >= 2) return json({ error: "RATE_LIMITED" }, 429);

  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  const code = String(bytes[0] % 1000000).padStart(6, "0");
  const codeHash = await hmacCode(secret, targetUserId + ":" + challenge.device_hash + ":" + code);
  const expiresAt = new Date(now + 10 * 60_000).toISOString();
  const { data: created, error: insertError } = await db.from("equus_device_challenges")
    .insert({
      user_id: targetUserId,
      device_hash: challenge.device_hash,
      code_hash: codeHash,
      expires_at: expiresAt,
      attempts: 0,
    }).select("id").single();
  if (insertError || !created) return json({ error: "CREATION_FAILED" }, 500);

  const { error: auditError } = await db.from("equus_admin_device_code_audit")
    .insert({
      admin_user_id: user.id,
      target_user_id: targetUserId,
      original_challenge_id: challengeId,
      replacement_challenge_id: created.id,
    });
  if (auditError) {
    await db.from("equus_device_challenges").delete().eq("id", created.id);
    return json({ error: "AUDIT_FAILED" }, 500);
  }

  // Never log, email, or persist the plaintext code. It is returned only once.
  return json({ code, expiresAt, oneTime: true });
});
