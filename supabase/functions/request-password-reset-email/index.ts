import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const siteUrl = Deno.env.get("EQUUS_SITE_URL") || "https://equus-47036e07.pages.dev";
    if (!supabaseUrl || !serviceRoleKey) return json({ error: "SERVER_CONFIGURATION_ERROR" }, 500);

    const body = await req.json().catch(() => ({}));
    const email = String(body?.email || "").trim().toLowerCase();
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) return json({ ok: true });

    const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: users, error: listError } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (listError) {
      console.error("Password reset user lookup failed:", listError);
      return json({ ok: true });
    }

    const user = users.users.find((u) => String(u.email || "").toLowerCase() === email);
    if (!user?.email) return json({ ok: true });

    const redirectTo = siteUrl.replace(/\/$/, "") + "/reset-password";
    const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
      type: "recovery",
      email: user.email,
      options: { redirectTo },
    });
    if (linkError || !linkData?.properties?.action_link) {
      console.error("Password reset link generation failed:", linkError);
      return json({ ok: true });
    }

    const { error: queueError } = await supabase.from("email_events").insert({
      event_key: "password-reset-" + user.id + "-" + crypto.randomUUID(),
      event_type: "password_reset",
      user_id: user.id,
      email: user.email,
      payload: { reset_url: linkData.properties.action_link, test: false },
      status: "pending",
    });
    if (queueError) {
      console.error("Password reset email queue failed:", queueError);
      return json({ ok: true });
    }
    return json({ ok: true });
  } catch (error) {
    console.error("request-password-reset-email failed:", error);
    return json({ ok: true });
  }
});
