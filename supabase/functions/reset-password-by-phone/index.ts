// Password recovery using the existing email + phone verification flow.
// This remains free, but is protected by per-account and per-client rate limits.
// For a stronger recovery flow later, replace this with a single-use email/OTP token.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const normalizePhone = (p: string) =>
  p.replace(/[\s\-()]/g, "").replace(/^00/, "+");

async function sha256(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { email, phone, new_password } = await req.json();
    const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
    const normalizedPhone = typeof phone === "string" ? normalizePhone(phone.trim()) : "";

    if (!normalizedEmail || !normalizedPhone || !new_password) {
      return json({ error: "Nepavyko patvirtinti duomenų." }, 400);
    }
    if (typeof new_password !== "string" || new_password.length < 8) {
      return json({ error: "Slaptažodis per trumpas (min. 8 simboliai)" }, 400);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const forwardedFor = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    const clientIp =
      req.headers.get("cf-connecting-ip") ??
      req.headers.get("x-real-ip") ??
      forwardedFor ??
      "unknown";

    const [accountKey, ipKey] = await Promise.all([
      sha256(`reset-account:${normalizedEmail}:${normalizedPhone}`),
      sha256(`reset-ip:${clientIp}`),
    ]);

    const [{ data: accountAllowed, error: accountRateError }, { data: ipAllowed, error: ipRateError }] =
      await Promise.all([
        admin.rpc("consume_equus_rate_limit", {
          _bucket: "password-reset-account",
          _key_hash: accountKey,
          _limit: 5,
          _window_seconds: 900,
        }),
        admin.rpc("consume_equus_rate_limit", {
          _bucket: "password-reset-ip",
          _key_hash: ipKey,
          _limit: 20,
          _window_seconds: 900,
        }),
      ]);

    if (accountRateError || ipRateError) {
      console.error("Password reset rate-limit check failed:", accountRateError ?? ipRateError);
      return json({ error: "Nepavyko apdoroti užklausos. Pabandykite vėliau." }, 503);
    }
    if (accountAllowed !== true || ipAllowed !== true) {
      return json({ error: "Per daug bandymų. Pabandykite vėliau." }, 429);
    }

    // Find the profile by phone without listing auth.users.
    // The project is intentionally small, so a bounded profile read is fine.
    const { data: profiles, error: profileError } = await admin
      .from("profiles")
      .select("id, phone")
      .limit(500);

    if (profileError) {
      console.error("Password reset profile lookup failed:", profileError);
      return json({ error: "Nepavyko apdoroti užklausos." }, 500);
    }

    const profile = (profiles ?? []).find(
      (p) => p.phone && normalizePhone(String(p.phone)) === normalizedPhone,
    );

    if (!profile) {
      // Keep invalid identity responses generic to reduce account enumeration.
      return json({ error: "Nepavyko patvirtinti duomenų." }, 400);
    }

    const { data: userData, error: userError } =
      await admin.auth.admin.getUserById(profile.id);

    if (userError || !userData?.user?.email ||
        userData.user.email.toLowerCase() !== normalizedEmail) {
      return json({ error: "Nepavyko patvirtinti duomenų." }, 400);
    }

    const { error: updateError } = await admin.auth.admin.updateUserById(
      profile.id,
      { password: new_password },
    );

    if (updateError) {
      console.error("Password reset update failed:", updateError);
      return json({ error: "Nepavyko pakeisti slaptažodžio." }, 500);
    }

    return json({ ok: true });
  } catch (e) {
    console.error("Password reset error:", e);
    return json({ error: "Nepavyko apdoroti užklausos." }, 500);
  }

  function json(b: unknown, status = 200) {
    return new Response(JSON.stringify(b), {
      status,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  }
});
