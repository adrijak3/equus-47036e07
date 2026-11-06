import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function esc(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function base64Url(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function encodeMimeHeader(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `=?UTF-8?B?${btoa(binary)}?=`;
}

function serviceLabel(type: string) {
  const labels: Record<string, string> = {
    mazylio_30: "Mažylio svajonė · 30 min.",
    mazylio_45: "Mažylio svajonė · 45 min.",
    sportine: "Sportinė jojimo treniruotė",
    individuali: "Individuali jojimo treniruotė",
  };
  return labels[type] ?? "Jojimo treniruotė";
}

function emailHtml(title: string, greeting: string, content: string) {
  return `
<!doctype html>
<html lang="lt">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Equus Jojimo Mokykla</title>
<style>
@media only screen and (max-width:620px) {
  .outer { padding:12px !important; }
  .email-card { padding:24px 20px !important; }
  .email-head { padding:26px 20px !important; }
  .email-title { font-size:26px !important; }
  .email-data { font-size:14px !important; }
}
</style>
</head>
<body style="margin:0;padding:0;background:#F3F6FB;color:#2C4259;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;">
<div class="outer" style="max-width:620px;margin:0 auto;padding:32px 16px;">
  <div style="padding:0 4px 16px;text-align:center;font-size:11px;letter-spacing:3px;font-weight:700;color:#687467;">EQUUS <span style="font-weight:400;letter-spacing:2px;">JOJIMO MOKYKLA</span></div>
  <div style="overflow:hidden;border:1px solid #D4E1EE;border-radius:18px;background:#FFFFFF;">
    <div class="email-head" style="background:#E4EDF7;padding:34px 34px 30px;border-bottom:1px solid #D4E2F0;">
      <div style="display:inline-block;border:1px solid #7897B7;border-radius:50%;width:36px;height:36px;line-height:36px;text-align:center;font-family:Georgia,serif;font-size:23px;color:#315F8B;margin-bottom:17px;">E</div>
      <div style="font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#5D7793;margin-bottom:10px;">EQUUS • INFORMACIJA</div>
      <h1 class="email-title" style="font-family:Georgia,'Times New Roman',serif;font-weight:400;font-size:31px;line-height:1.18;letter-spacing:-.5px;color:#213F60;margin:0 0 12px;">${esc(title)}</h1>
      <p style="margin:0;font-size:15px;line-height:1.6;color:#536E89;">Informacija apie Jūsų registraciją į Equus jojimo mokyklą</p>
    </div>
    <div class="email-card" style="padding:32px 34px 28px;background:#FFFFFF;font-size:15px;line-height:1.7;color:#344B63;">
      ${greeting}\n      ${content}
      <div style="height:1px;background:#E2EAF3;margin:28px 0 18px;"></div>
      <p style="margin:0;font-size:13px;line-height:1.7;color:#647C94;">Klausimai? Mielai padėsime:<br><a href="mailto:equusjojimomokykla@gmail.com" style="font-weight:600;color:#285C8A;text-decoration:underline;">equusjojimomokykla@gmail.com</a></p>
    </div>
  </div>
  <div style="padding:18px 10px 4px;text-align:center;color:#72869B;font-size:12px;line-height:1.7;">Equus Jojimo Mokykla <span style="color:#AABDCF;">•</span> Laiškas iš oficialios Equus sistemos</div>
</div>
</body></html>`;
}


async function sendGmail(to: string, subject: string, html: string) {
  const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
  const refreshToken = Deno.env.get("GOOGLE_REFRESH_TOKEN");
  if (!clientId || !clientSecret || !refreshToken) throw new Error("GMAIL_OAUTH_NOT_CONFIGURED");

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }),
  });
  const tokenData = await tokenResponse.json();
  if (!tokenResponse.ok || !tokenData.access_token) throw new Error(`GOOGLE_TOKEN_REFRESH_FAILED: HTTP ${tokenResponse.status} ${JSON.stringify(tokenData)}`);

  const from = Deno.env.get("GMAIL_FROM_EMAIL") || "Equus Jojimo Mokykla <equusjojimomokykla@gmail.com>";
  const mime = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeMimeHeader(subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/html; charset=UTF-8",
    "",
    html,
  ].join("\r\n");
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${tokenData.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw: base64Url(mime) }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`GMAIL_SEND_FAILED_${response.status}: ${JSON.stringify(data)}`);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !serviceKey || !anonKey) throw new Error("SUPABASE_CONFIGURATION_MISSING");

    const body = await req.json();
    const requestId = String(body.request_id ?? "");
    const action = String(body.action ?? "");
    if (!requestId || !["received", "status"].includes(action)) return json({ error: "INVALID_REQUEST" }, 400);

    const adminClient = createClient(supabaseUrl, serviceKey);
    const { data: registration, error: rowError } = await adminClient
      .from("public_registration_requests").select("*").eq("id", requestId).maybeSingle();
    if (rowError) throw rowError;
    if (!registration) return json({ error: "REGISTRATION_NOT_FOUND" }, 404);

    if (action === "received") {
      if (!body.public_token || body.public_token !== registration.public_token) return json({ error: "INVALID_PUBLIC_TOKEN" }, 403);
    } else {
      const authHeader = req.headers.get("Authorization") ?? "";
      const jwt = authHeader.replace(/^Bearer\s+/i, "");
      if (!jwt) return json({ error: "UNAUTHORIZED" }, 401);
      const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
      const { data: userData, error: userError } = await userClient.auth.getUser(jwt);
      if (userError || !userData.user) return json({ error: "UNAUTHORIZED" }, 401);
      const { data: isAdmin, error: roleError } = await adminClient.rpc("has_role", { _user_id: userData.user.id, _role: "admin" });
      if (roleError) throw roleError;
      if (!isAdmin) return json({ error: "NOT_ALLOWED" }, 403);
    }

    const name = `${registration.first_name ?? ""} ${registration.last_name ?? ""}`.trim();
    const service = serviceLabel(registration.service_type);
    const price = Number(registration.price_eur ?? 0).toFixed(2).replace(/\.00$/, "");
    const date = registration.proposed_date ?? registration.requested_date ?? "";
    const time = String(registration.proposed_time ?? registration.requested_time ?? "").slice(0, 5);
    const link = `https://equusjm.pages.dev/registracija/${registration.public_token}`;
    const dateLine = date ? `<p><strong>Data:</strong> ${esc(date)}</p>` : "";
    const timeLine = time ? `<p><strong>Laikas:</strong> ${esc(time)}</p>` : "";
    const priceLine = `<p><strong>Kaina:</strong> ${esc(price)} €</p>`;

    let subject = "Gavome Jūsų Equus registracijos užklausą";
    let title = "Registracijos užklausa gauta";
    let content = `<p>Gavome Jūsų registracijos užklausą į Equus jojimo mokyklą.</p><p><strong>Paslauga:</strong> ${esc(service)}</p>${dateLine}${timeLine}${priceLine}<p>Netrukus patvirtinsime registraciją arba pasiūlysime kitą laiką.</p>`;

    if (action === "status") {
      const status = String(registration.status ?? "");
      const note = registration.admin_note ? `<p>${esc(registration.admin_note)}</p>` : "";
      if (status === "proposed") {
        subject = "Equus pasiūlė Jums treniruotės laiką";
        title = "Pasiūlytas treniruotės laikas";
        content = `Administracija pasiūlė Jums šį laiką:<p><strong>Paslauga:</strong> ${esc(service)}</p>${dateLine}${timeLine}${priceLine}${note}<p>Peržiūrėkite pasiūlymą ir patvirtinkite arba paprašykite kito laiko:</p>`;
      } else if (status === "approved") {
        subject = "Equus registracija patvirtinta";
        title = "Registracija patvirtinta";
        content = `Jūsų registracija patvirtinta administracijos.<p><strong>Paslauga:</strong> ${esc(service)}</p>${dateLine}${timeLine}${priceLine}${note}`;
      } else if (status === "rejected") {
        subject = "Equus registracijos atnaujinimas";
        title = "Registracija atmesta";
        content = `Deja, šiuo metu negalime patvirtinti Jūsų registracijos.${note}`;
      } else {
        subject = "Equus registracijos atnaujinimas";
        title = "Registracijos atnaujinimas";
        content = `Pasikeitė Jūsų registracijos būsena: ${esc(status)}.${note}`;
      }
    }

    content += `<p style="margin-top:22px;"><a href="${esc(link)}" style="display:inline-block;padding:12px 20px;border-radius:999px;background:#5b6153;color:#fff;text-decoration:none;font-weight:700;">Peržiūrėti registracijos būseną</a></p><p style="margin-top:18px;">Su pagarba,<br>Equus Jojimo Mokykla</p>`;
    await sendGmail(registration.email, subject, emailHtml(title, `Sveiki, ${esc(name)}!`, content));
    return json({ ok: true });
  } catch (error) {
    console.error("send-public-registration-email failed:", error);
    return json({ ok: false, error: error instanceof Error ? error.message : "UNKNOWN_ERROR" }, 500);
  }
});
