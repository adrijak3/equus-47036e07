// Admin-only: read or directly change a user's Supabase Auth email.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Missing auth" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsErr } = await userClient.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims) return json({ error: "Unauthorized" }, 401);

    const callerId = claimsData.claims.sub as string;
    const { data: isAdmin } = await userClient.rpc("has_role", {
      _user_id: callerId,
      _role: "admin",
    });
    if (!isAdmin) return json({ error: "Forbidden" }, 403);

    const body = await req.json();
    const userId = body?.user_id;
    if (!userId || typeof userId !== "string") return json({ error: "user_id required" }, 400);

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: target, error: getError } = await admin.auth.admin.getUserById(userId);
    if (getError || !target.user) return json({ error: getError?.message || "Vartotojas nerastas" }, 404);

    if (body?.email === undefined) {
      return json({ ok: true, email: target.user.email ?? "" });
    }

    const email = String(body.email).trim().toLowerCase().replace(/\s+/g, "");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ error: "Įveskite galiojantį el. pašto adresą" }, 400);
    }

    const { data: updated, error: updateError } = await admin.auth.admin.updateUserById(userId, {
      email,
      email_confirm: true,
    });
    if (updateError) return json({ error: updateError.message }, 400);

    return json({
      ok: true,
      previous_email: target.user.email ?? "",
      email: updated.user?.email ?? email,
    });
  } catch (e) {
    return json({ error: (e as Error).message || "Klaida" }, 500);
  }

  function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
