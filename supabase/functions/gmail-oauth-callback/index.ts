import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function page(title: string, body: string, status = 200) {
  return new Response(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>body{font-family:Arial,sans-serif;background:#f6f3ee;color:#28231f;padding:32px}main{max-width:760px;margin:auto;background:white;border-radius:18px;padding:28px}code{word-break:break-all;display:block;background:#f3f0eb;padding:14px;border-radius:10px}</style>
</head><body><main>${body}</main></body></html>`, {
    status,
    headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" },
  });
}

function base64UrlDecode(value: string) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - value.length % 4) % 4);
  const binary = atob(normalized);
  return new Uint8Array([...binary].map((c) => c.charCodeAt(0)));
}

async Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET") return page("Equus Gmail", "<h1>Method not allowed</h1>", 405);

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const googleError = url.searchParams.get("error");

  if (googleError) return page("Equus Gmail", `<h1>Google authorization was cancelled</h1><p>${googleError}</p>`, 400);
  if (!code || !state) return page("Equus Gmail", "<h1>Missing OAuth response</h1>", 400);

  const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
  const stateSecret = Deno.env.get("GOOGLE_OAUTH_STATE_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");

  if (!clientId || !clientSecret || !stateSecret || !supabaseUrl) {
    return page("Equus Gmail", "<h1>Server configuration is incomplete.</h1>", 500);
  }

  const parts = state.split(".");
  if (parts.length !== 3) return page("Equus Gmail", "<h1>Invalid OAuth state.</h1>", 400);

  const issuedAt = Number(parts[0]);
  const payload = `${parts[0]}.${parts[1]}`;
  const signature = parts[2];

  if (!Number.isFinite(issuedAt) || Math.abs(Date.now() / 1000 - issuedAt) > 600) {
    return page("Equus Gmail", "<h1>OAuth state expired. Start authorization again.</h1>", 400);
  }

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(stateSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    base64UrlDecode(signature),
    new TextEncoder().encode(payload),
  );
  if (!valid) return page("Equus Gmail", "<h1>Invalid OAuth state.</h1>", 400);

  const redirectUri = `${supabaseUrl}/functions/v1/gmail-oauth-callback`;
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  const tokenData = await tokenResponse.json();

  if (!tokenResponse.ok || !tokenData.refresh_token) {
    return page(
      "Equus Gmail",
      `<h1>Google token exchange failed</h1><pre>${JSON.stringify(tokenData, null, 2)}</pre>`,
      502,
    );
  }

  return page(
    "Equus Gmail",
    `<h1>Google Gmail authorization complete ✅</h1>
<p>Copy the refresh token below into the Supabase secret <code>GOOGLE_REFRESH_TOKEN</code>.</p>
<p><strong>Do not send this token to ChatGPT or anyone else.</strong></p>
<code>${tokenData.refresh_token}</code>
<p>After saving the secret, you can close this page.</p>`,
  );
});
