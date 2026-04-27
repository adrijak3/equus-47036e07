// Look up a user's email by their phone number, so the login form can accept
// either email or phone. Public endpoint (no JWT) — discloses only whether
// a phone is registered, returning the associated email if so.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const normalizePhone = (p: string) => p.replace(/[\s\-()]/g, "").replace(/^00/, "+");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { phone } = await req.json();
    if (!phone || typeof phone !== "string") return json({ error: "Trūksta telefono" }, 400);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const norm = normalizePhone(phone);
    // Find profile whose phone matches (after normalization)
    const { data: profs, error } = await admin.from("profiles").select("id, phone");
    if (error) return json({ error: error.message }, 500);
    const match = (profs ?? []).find((p) => p.phone && normalizePhone(p.phone) === norm);
    if (!match) return json({ error: "Vartotojas nerastas" }, 404);

    const { data: u, error: uErr } = await admin.auth.admin.getUserById(match.id);
    if (uErr || !u?.user?.email) return json({ error: "Vartotojas nerastas" }, 404);

    return json({ email: u.user.email });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }

  function json(b: unknown, status = 200) {
    return new Response(JSON.stringify(b), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});