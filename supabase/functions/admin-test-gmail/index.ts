import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "https://equusjm.pages.dev",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, "Content-Type": "application/json" },
});
const encode = (input: string) => {
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ error: "METHOD_NOT_ALLOWED" }, 405);
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const anon = Deno.env.get("SUPABASE_ANON_KEY");
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
    const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
    const refresh = Deno.env.get("GOOGLE_REFRESH_TOKEN");
    if (!url || !anon || !service || !clientId || !clientSecret || !refresh)
      return reply({ error: "SERVER_CONFIGURATION_ERROR" }, 500);

    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!jwt) return reply({ error: "UNAUTHORIZED" }, 401);
    const authClient = createClient(url, anon);
    const { data: { user }, error: userError } = await authClient.auth.getUser(jwt);
    if (userError || !user?.email) return reply({ error: "UNAUTHORIZED" }, 401);
    const admin = createClient(url, service);
    const { data: isAdmin, error: roleError } = await admin.rpc("has_role", {
      _user_id: user.id, _role: "admin",
    });
    if (roleError || isAdmin !== true) return reply({ error: "ADMIN_REQUIRED" }, 403);

    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId, client_secret: clientSecret,
        refresh_token: refresh, grant_type: "refresh_token",
      }),
    });
    const token = await tokenResponse.json();
    if (!tokenResponse.ok || !token.access_token) {
      console.error("Equus Gmail test: refresh failed", tokenResponse.status, token.error);
      return reply({ error: "GOOGLE_TOKEN_REFRESH_FAILED" }, 502);
    }

    const from = Deno.env.get("GMAIL_FROM_EMAIL") || "Equus Jojimo Mokykla <equusjojimomokykla@gmail.com>";
    const mime = [
      `From: ${from}`, `To: ${user.email}`,
      "Subject: Equus Gmail test",
      "MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "",
      "Equus Gmail test succeeded. This email was requested from the admin account.",
    ].join("\r\n");
    const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${token.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw: encode(mime) }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      console.error("Equus Gmail test: send failed", response.status, data.error?.status);
      return reply({ error: "GMAIL_SEND_FAILED", status: response.status }, 502);
    }
    console.log("Equus Gmail admin test accepted by Google");
    return reply({ ok: true, recipient: user.email });
  } catch (error) {
    console.error("Equus Gmail admin test unexpected error", error instanceof Error ? error.message : "unknown");
    return reply({ error: "INTERNAL_ERROR" }, 500);
  }
});
