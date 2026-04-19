// Reset password by verifying phone matches account email.
// Public endpoint (no JWT required) — security relies on knowing both email + matching phone.
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
    const { email, phone, new_password } = await req.json();
    if (!email || !phone || !new_password) {
      return json({ error: "Trūksta laukų" }, 400);
    }
    if (typeof new_password !== "string" || new_password.length < 8) {
      return json({ error: "Slaptažodis per trumpas (min. 8 simboliai)" }, 400);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Find user by email
    const { data: list, error: listErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (listErr) return json({ error: listErr.message }, 500);
    const target = list.users.find((u) => u.email?.toLowerCase() === String(email).toLowerCase());
    if (!target) return json({ error: "Vartotojas nerastas" }, 404);

    // Match phone from profile
    const { data: prof } = await admin.from("profiles").select("phone").eq("id", target.id).maybeSingle();
    if (!prof?.phone) return json({ error: "Telefonas nesutampa" }, 403);
    if (normalizePhone(prof.phone) !== normalizePhone(String(phone))) {
      return json({ error: "Telefonas nesutampa" }, 403);
    }

    const { error: updErr } = await admin.auth.admin.updateUserById(target.id, {
      password: new_password,
    });
    if (updErr) return json({ error: updErr.message }, 500);

    return json({ ok: true });
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
