// Admin-only: reset a user's password to "<firstname>_equus123".
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const slug = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 24) || "user";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Missing auth" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsErr } = await userClient.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims) return json({ error: "Unauthorized" }, 401);
    const callerId = claimsData.claims.sub as string;

    const { data: isAdmin } = await userClient.rpc("has_role", { _user_id: callerId, _role: "admin" });
    if (!isAdmin) return json({ error: "Forbidden" }, 403);

    const { user_id } = await req.json();
    if (!user_id) return json({ error: "user_id required" }, 400);

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: prof } = await admin.from("profiles").select("full_name").eq("id", user_id).maybeSingle();
    const first = (prof?.full_name ?? "user").trim().split(/\s+/)[0];
    const newPassword = `${slug(first)}_equus123`;

    const { error: updErr } = await admin.auth.admin.updateUserById(user_id, { password: newPassword });
    if (updErr) return json({ error: updErr.message }, 500);
    return json({ ok: true, password: newPassword });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }

  function json(b: unknown, status = 200) {
    return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});