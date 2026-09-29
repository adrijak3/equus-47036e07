// Public phone-to-email lookup used by the login form.
// The result is intentionally limited to the matching email, but the endpoint
// is rate-limited to reduce bulk account enumeration.
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
    const { phone } = await req.json();
    if (!phone || typeof phone !== "string") {
      return json({ error: "Trūksta telefono" }, 400);
    }

    const normalizedPhone = normalizePhone(phone.trim());
    if (!normalizedPhone) return json({ error: "Trūksta telefono" }, 400);

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

    const [phoneKey, ipKey] = await Promise.all([
      sha256(`lookup-phone:${normalizedPhone}`),
      sha256(`lookup-ip:${clientIp}`),
    ]);

    const [{ data: phoneAllowed, error: phoneRateError }, { data: ipAllowed, error: ipRateError }] =
      await Promise.all([
        admin.rpc("consume_equus_rate_limit", {
          _bucket: "phone-lookup-number",
          _key_hash: phoneKey,
          _limit: 10,
          _window_seconds: 900,
        }),
        admin.rpc("consume_equus_rate_limit", {
          _bucket: "phone-lookup-ip",
          _key_hash: ipKey,
          _limit: 30,
          _window_seconds: 900,
        }),
      ]);

    if (phoneRateError || ipRateError) {
      console.error("Phone lookup rate-limit check failed:", phoneRateError ?? ipRateError);
      return json({ error: "Nepavyko apdoroti užklausos. Pabandykite vėliau." }, 503);
    }
    if (phoneAllowed !== true || ipAllowed !== true) {
      return json({ error: "Per daug bandymų. Pabandykite vėliau." }, 429);
    }

    const { data: profiles, error } = await admin
      .from("profiles")
      .select("id, phone")
      .limit(500);

    if (error) {
      console.error("Phone lookup profile query failed:", error);
      return json({ error: "Nepavyko apdoroti užklausos." }, 500);
    }

    const match = (profiles ?? []).find(
      (p) => p.phone && normalizePhone(String(p.phone)) === normalizedPhone,
    );
    if (!match) return json({ error: "Vartotojas nerastas" }, 404);

    const { data: userData, error: userError } =
      await admin.auth.admin.getUserById(match.id);
    if (userError || !userData?.user?.email) {
      return json({ error: "Vartotojas nerastas" }, 404);
    }

    return json({ email: userData.user.email });
  } catch (e) {
    console.error("Phone lookup error:", e);
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
