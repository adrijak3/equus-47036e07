import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-equus-cron-secret",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function esc(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatEur(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toFixed(2)} €` : "—";
}

function formatDate(value: unknown) {
  if (!value) return "—";
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return esc(value);
  return new Intl.DateTimeFormat("lt-LT", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "Europe/Vilnius",
  }).format(d);
}

function packageLabel(value: string | null | undefined) {
  if (value === "po2") return "Asmeninės pamokos po 2";
  if (value === "group") return "Grupinės pamokos";
  return value || "—";
}

function horseLabel(value: string | null | undefined) {
  if (value === "school") return "Mokyklos žirgas";
  if (value === "own" || value === "private") return "Privatus žirgas";
  return value || "—";
}

function lessonKindLabel(value: unknown, isIndividual: unknown) {
  const kind = String(value ?? "").toLowerCase();
  if (kind === "individual" || isIndividual === true) return "Individuali";
  if (kind === "po2") return "Po du";
  return "Grupinė";
}

function formatTime(value: unknown) {
  if (!value) return "";
  return String(value).slice(0, 5);
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    const own = Object.getOwnPropertyNames(error).reduce<Record<string, unknown>>((acc, key) => {
      try {
        acc[key] = (error as any)[key];
      } catch {
        acc[key] = "<unreadable>";
      }
      return acc;
    }, {});
    const message = String(error.message ?? "");
    if (message && message !== "[object Object]") return message;
    const serialized = JSON.stringify(own);
    return serialized && serialized !== "{}"
      ? serialized
      : message || error.name || "Unknown error";
  }

  if (error && typeof error === "object") {
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }

  return String(error ?? "Unknown error");
}

function trainingHistoryHtml(trainings: any[]) {
  if (!trainings.length) {
    return `
      <div style="margin-top:20px;padding:16px;border-radius:16px;background:#fff8fa;border:1px solid #f1d6df;">
        <div style="font-size:12px;letter-spacing:1.8px;text-transform:uppercase;color:#a55d78;">Jūsų treniruotės</div>
        <p style="margin:8px 0 0;color:#8b737c;font-size:13px;line-height:1.6;">
          Šiame abonemente užbaigtų treniruočių dar nėra.
        </p>
      </div>`;
  }

  const rows = trainings.map((t) => `
    <tr>
      <td style="padding:9px 6px 9px 0;border-bottom:1px solid #f2e4e9;color:#5f4b53;white-space:nowrap;">
        ${esc(formatDate(t.slot_date))}
        ${t.slot_time ? `<br><span style="font-size:12px;color:#a18a93;">${esc(formatTime(t.slot_time))}</span>` : ""}
      </td>
      <td style="padding:9px 6px;border-bottom:1px solid #f2e4e9;color:#5f4b53;">
        ${esc(lessonKindLabel(t.lesson_kind, t.is_individual))}
      </td>
      <td style="padding:9px 0 9px 6px;border-bottom:1px solid #f2e4e9;color:#5f4b53;text-align:right;">
        ${esc(t.horse_name || "—")}
      </td>
    </tr>`).join("");

  return `
    <div style="margin-top:20px;padding:18px;border-radius:16px;background:#fff8fa;border:1px solid #f1d6df;">
      <div style="font-size:12px;letter-spacing:1.8px;text-transform:uppercase;color:#a55d78;">Jūsų treniruotės šiame abonemente</div>
      <table style="width:100%;border-collapse:collapse;margin-top:10px;font-size:13px;">
        <thead>
          <tr>
            <th style="padding:7px 6px 7px 0;text-align:left;color:#9a7f89;font-size:11px;font-weight:700;">Data</th>
            <th style="padding:7px 6px;text-align:left;color:#9a7f89;font-size:11px;font-weight:700;">Treniruotė</th>
            <th style="padding:7px 0 7px 6px;text-align:right;color:#9a7f89;font-size:11px;font-weight:700;">Žirgas</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function encodeMimeHeader(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `=?UTF-8?B?${btoa(binary)}?=`;
}

function base64UrlEncode(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

async function getGmailAccessToken() {
  const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
  const refreshToken = Deno.env.get("GOOGLE_REFRESH_TOKEN");

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("GMAIL_OAUTH_NOT_CONFIGURED");
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  const data = await response.json();
  if (!response.ok || !data.access_token) {
    throw new Error(`GOOGLE_TOKEN_REFRESH_FAILED: HTTP ${response.status} ${JSON.stringify(data)}`);
  }
  return data.access_token as string;
}

async function sendGmailEmail(
  accessToken: string,
  from: string,
  to: string,
  subject: string,
  html: string,
) {
  const message = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeMimeHeader(subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/html; charset=UTF-8",
    "",
    html,
  ].join("\r\n");

  const response = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw: base64UrlEncode(message) }),
    },
  );

  const data = await response.json();
  return { response, data };
}

function pinkShell(title: string, subtitle: string, inner: string) {
  return `
<!doctype html>
<html lang="lt">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Equus</title>
</head>
<body style="margin:0;background:#fff6f8;color:#33252a;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:620px;margin:0 auto;padding:30px 16px;">
    <div style="background:linear-gradient(135deg,#fff0f4,#f8dbe5);border:1px solid #efc5d3;border-radius:24px;padding:28px 28px 24px;box-shadow:0 8px 30px rgba(160,80,105,.10);">
      <div style="font-size:12px;letter-spacing:3px;text-transform:uppercase;color:#a55d78;font-weight:700;">Equus Jojimo Mokykla</div>
      <h1 style="margin:2px 0 8px;font-size:28px;line-height:1.2;color:#6f3049;">${esc(title)}</h1>
      <p style="margin:0;color:#805d69;font-size:15px;line-height:1.6;">${esc(subtitle)}</p>
    </div>
    <div style="margin-top:14px;background:#fff;border:1px solid #efdce3;border-radius:20px;padding:24px 26px;box-shadow:0 4px 18px rgba(160,80,105,.06);">
      ${inner}
    </div>
    <p style="margin:20px 4px 0;color:#9a7f89;font-size:12px;line-height:1.6;text-align:center;">
      Šis laiškas išsiųstas automatiškai iš Equus Jojimo Mokyklos sistemos.<br>
      This email was sent automatically by the Equus Riding School system.
    </p>
    <div style="margin:24px 4px 0;padding-top:16px;border-top:1px solid #eadde2;color:#8f7b83;font-size:10.5px;line-height:1.65;text-align:left;">
      Pastaba: šiame laiške, įskaitant jo priedus, esanti informacija yra konfidenciali ir skirta tik adresatui. Jeigu Jūs nesate nurodytas adresatas, prašome įsidėmėti, kad bet koks šiame laiške esančios informacijos platinimas, dauginimas, kopijavimas ar naudojimas yra griežtai draudžiamas. Jeigu Jūs per klaidą gavote šį laišką, mes atsiprašome už sutrukdymą ir prašome nedelsiant informuoti siuntėją elektroniniu paštu
      <a href="mailto:equusjojimomokykla@gmail.com" style="color:#8f6474;text-decoration:none;">equusjojimomokykla@gmail.com</a>
      bei ištrinti laišką ir visus jo priedus iš Jūsų sistemos. Dėkojame.
    </div>
  </div>
</body>
</html>`;
}

function subscriptionPurchaseHtml(clientName: string, subscription: any, trainings: any[]) {
  const remaining = Math.max(
    0,
    Number(subscription.lessons_total) - Number(subscription.lessons_used ?? 0),
  );
  const inner = `
    <p style="margin:0 0 18px;font-size:15px;line-height:1.6;">Sveiki, ${esc(clientName)}, Jūsų abonemento pirkimas sėkmingai užregistruotas.</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <tr><td style="padding:8px 0;color:#8b737c;">Pamokos</td><td style="padding:8px 0;text-align:right;font-weight:600;">${esc(subscription.lessons_total)}</td></tr>
      <tr><td style="padding:8px 0;color:#8b737c;">Tipas</td><td style="padding:8px 0;text-align:right;font-weight:600;">${esc(packageLabel(subscription.package_type))}</td></tr>
      <tr><td style="padding:8px 0;color:#8b737c;">Žirgai</td><td style="padding:8px 0;text-align:right;font-weight:600;">${esc(horseLabel(subscription.horse_type))}</td></tr>
      <tr><td style="padding:8px 0;color:#8b737c;">Sumokėta</td><td style="padding:8px 0;text-align:right;font-weight:600;">${formatEur(subscription.price)}</td></tr>
      <tr><td style="padding:8px 0;color:#8b737c;">Pirkimo data</td><td style="padding:8px 0;text-align:right;font-weight:600;">${formatDate(subscription.purchase_date)}</td></tr>
      <tr><td style="padding:8px 0;color:#8b737c;">Galioja iki</td><td style="padding:8px 0;text-align:right;font-weight:600;">${formatDate(subscription.expires_at)}</td></tr>
    </table>
    <div style="margin-top:18px;padding:16px;border-radius:14px;background:#fff4f7;text-align:center;">
      <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#a55d78;">Liko pamokų</div>
      <div style="font-size:40px;font-weight:700;color:#6f3049;margin-top:5px;">${remaining}</div>
      <div style="font-size:13px;color:#8b737c;">${Number(subscription.lessons_used ?? 0)} panaudota iš ${Number(subscription.lessons_total)}</div>
    </div>
    ${trainingHistoryHtml(trainings)}
    <div style="margin-top:20px;padding:14px 16px;border-radius:14px;background:#fff0f5;border:1px solid #f0cbd8;text-align:center;color:#805d69;font-size:13px;line-height:1.6;">
      Ačiū, kad renkatės Equus Jojimo Mokyklą.
    </div>`;
  return pinkShell("Abonementas patvirtintas", "Jūsų Equus abonemento informacija", inner);
}

function subscriptionExpiringHtml(clientName: string, payload: any) {
  const lastTraining = formatDate(payload?.last_training_date);
  const remaining = Number(payload?.remaining ?? 0);
  const inner = `
    <p style="margin:0;font-size:15px;line-height:1.7;">Sveiki, ${esc(clientName)},</p>
    <p style="margin:10px 0 0;font-size:15px;line-height:1.7;">
      Norime priminti, kad Jūsų dabartinio abonemento <strong>paskutinė suplanuota treniruotė yra ${esc(lastTraining)}</strong>.
    </p>
    <div style="margin-top:20px;padding:18px;border-radius:16px;background:#fff4f7;border:1px solid #f1d6df;">
      <div style="font-size:12px;letter-spacing:1.8px;text-transform:uppercase;color:#a55d78;">Abonemento pabaiga</div>
      <div style="font-size:25px;font-weight:700;color:#6f3049;margin-top:6px;">${esc(lastTraining)}</div>
      <div style="font-size:13px;color:#8b737c;margin-top:5px;">Po šios treniruotės abonemento pamokos bus išnaudotos / suplanuotos iki pabaigos.</div>
    </div>
    <p style="margin:18px 0 0;color:#765f68;font-size:14px;line-height:1.7;">
      Jei norėsite tęsti treniruotes, galite pasirūpinti kitu abonementu iš anksto. Liko pamokų: <strong>${remaining}</strong>.
    </p>
    <p style="margin:10px 0 0;color:#765f68;font-size:14px;line-height:1.7;">
      Po šios treniruotės abonemento pamokos bus išnaudotos iki pabaigos.
    </p>`;
  return pinkShell("Jūsų abonementas netrukus baigsis", "Mažas priminimas prieš paskutinę suplanuotą treniruotę", inner);
}

function globalAnnouncementHtml(clientName: string, payload: any) {
  const titleLt = String(payload?.title_lt || "Svarbus Equus atnaujinimas");
  const titleEn = String(payload?.title_en || "Important Equus update");
  const bodyLt = String(payload?.body_lt || "");
  const bodyEn = String(payload?.body_en || "");
  const url = String(payload?.url || "/grafikas");
  const inner = `
    <p style="margin:0 0 18px;font-size:15px;line-height:1.6;">Sveiki, ${esc(clientName)},</p>
    <div style="padding:16px 18px;border-radius:15px;background:#fff4f7;border:1px solid #f1d6df;">
      <h2 style="margin:0;color:#6f3049;font-size:20px;">${esc(titleLt)}</h2>
      <p style="margin:10px 0 0;white-space:pre-wrap;font-size:15px;line-height:1.7;">${esc(bodyLt)}</p>
    </div>
    <div style="margin-top:18px;padding-top:18px;border-top:1px solid #eee0e5;">
      <h3 style="margin:0;color:#6f3049;font-size:16px;">${esc(titleEn)}</h3>
      <p style="margin:8px 0 0;white-space:pre-wrap;color:#705e66;font-size:14px;line-height:1.7;">${esc(bodyEn)}</p>
    </div>
    <div style="margin-top:20px;text-align:center;">
      <a href="https://equus-47036e07.pages.dev${url.startsWith("/") ? url : "/" + url}"
         style="display:inline-block;padding:12px 20px;border-radius:999px;background:#d989a5;color:#fff;text-decoration:none;font-weight:700;">
        Atidaryti Equus / Open Equus
      </a>
    </div>`;
  return pinkShell(titleLt, "Svarbi informacija iš Equus", inner);
}


function passwordResetHtml(clientName: string, payload: any) {
  const resetUrl = String(payload?.reset_url || "");
  const inner =
    '<p style="margin:0 0 18px;font-size:15px;line-height:1.7;">Sveiki, ' +
    esc(clientName) +
    ',</p>' +
    '<p style="margin:0;font-size:15px;line-height:1.7;">Gavome prašymą pakeisti Jūsų Equus paskyros slaptažodį.</p>' +
    '<p style="margin:10px 0 0;color:#765f68;font-size:14px;line-height:1.7;">Paspauskite žemiau esantį mygtuką ir nustatykite naują slaptažodį. Ši nuoroda skirta tik Jums ir yra vienkartinė.</p>' +
    '<div style="margin:24px 0;text-align:center;">' +
    '<a href="' + esc(resetUrl) + '" style="display:inline-block;padding:13px 24px;border-radius:999px;background:#d989a5;color:#fff;text-decoration:none;font-weight:700;">Nustatyti naują slaptažodį</a>' +
    '</div>' +
    '<p style="margin:0;color:#9a7f89;font-size:12px;line-height:1.6;">Jei šio prašymo nepateikėte, tiesiog ignoruokite šį laišką.</p>';
  return pinkShell("Slaptažodžio atkūrimas", "Equus Jojimo Mokyklos paskyros saugumo pranešimas", inner);
}

async function getSubscriptionTrainingHistory(supabase: any, subscriptionId: string) {
  const { data: bookings, error: bookingsError } = await supabase
    .from("bookings")
    .select("id,slot_date,slot_time,status,is_individual,lesson_kind")
    .eq("subscription_id", subscriptionId)
    .eq("status", "completed")
    .eq("counts_in_subscription", true)
    .order("slot_date", { ascending: true })
    .order("slot_time", { ascending: true });

  if (bookingsError) throw bookingsError;
  const rows = bookings ?? [];
  if (!rows.length) return [];

  const ids = rows.map((b: any) => b.id);
  const { data: assignments, error: assignmentsError } = await supabase
    .from("horse_assignments")
    .select("booking_id,horse_id")
    .in("booking_id", ids);
  if (assignmentsError) throw assignmentsError;

  const horseIds = Array.from(new Set((assignments ?? []).map((a: any) => a.horse_id).filter(Boolean))) as string[];
  let horses: any[] = [];
  if (horseIds.length) {
    const { data, error } = await supabase.from("horses").select("id,name").in("id", horseIds);
    if (error) throw error;
    horses = data ?? [];
  }

  const horseById = new Map(horses.map((h: any) => [h.id, h.name]));
  const horseByBooking = new Map(
    (assignments ?? []).map((a: any) => [a.booking_id, horseById.get(a.horse_id) ?? "—"]),
  );

  return rows.map((b: any) => ({ ...b, horse_name: horseByBooking.get(b.id) ?? "—" }));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  const expectedCronSecret = Deno.env.get("EQUUS_CRON_SECRET");
  const suppliedCronSecret = req.headers.get("x-equus-cron-secret");
  if (!expectedCronSecret || !suppliedCronSecret || suppliedCronSecret !== expectedCronSecret) {
    return json({ error: "UNAUTHORIZED" }, 401);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const fromEmail = Deno.env.get("GMAIL_FROM_EMAIL") || "Equus Jojimo Mokykla <equusjojimomokykla@gmail.com>";

    if (!supabaseUrl || !serviceRoleKey) return json({ error: "SERVER_CONFIGURATION_ERROR" }, 500);

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { error: recoveryError } = await supabase.rpc("recover_stale_email_events", { _stale_after: "15 minutes" });
    if (recoveryError) {
      console.error("Failed to recover stale email events:", recoveryError);
      return json({ error: "QUEUE_RECOVERY_FAILED" }, 500);
    }

    const { data: claimed, error: claimError } = await supabase.rpc("claim_email_event");
    if (claimError) {
      console.error("Failed to claim email event:", claimError);
      return json({ error: "QUEUE_CLAIM_FAILED" }, 500);
    }

    const claimedEvent = Array.isArray(claimed) ? claimed[0] : claimed;
    if (!claimedEvent) return json({ ok: true, processed: false, reason: "NO_PENDING_EVENTS" });

    const eventId = claimedEvent.id as string;

    // Fetch the complete row after claiming so new payload-based event types
    // do not depend on the return shape of the older claim RPC.
    const { data: event, error: eventError } = await supabase
      .from("email_events")
      .select("id,event_type,user_id,email,subscription_id,booking_id,payload")
      .eq("id", eventId)
      .maybeSingle();

    if (eventError) throw eventError;
    if (!event) throw new Error("EMAIL_EVENT_NOT_FOUND");

    try {
      if (!event.email) {
        await supabase.rpc("mark_email_event_failed", {
          _event_id: eventId,
          _error: "Email address is missing",
          _retryable: false,
        });
        return json({ ok: false, processed: true, event_id: eventId, error: "EMAIL_MISSING" }, 422);
      }

      if (!["subscription_purchase", "subscription_expiring", "global_important_update", "password_reset"].includes(event.event_type)) {
        await supabase.rpc("mark_email_event_failed", {
          _event_id: eventId,
          _error: "Unsupported event type: " + event.event_type,
          _retryable: false,
        });
        return json({ ok: false, processed: true, event_id: eventId, error: "UNSUPPORTED_EVENT_TYPE" }, 422);
      }

      let clientName = "Kliente";
      if (event.user_id) {
        const { data: profile, error: profileError } = await supabase
          .from("profiles")
          .select("full_name")
          .eq("id", event.user_id)
          .maybeSingle();
        if (profileError) throw profileError;
        if (profile?.full_name?.trim()) clientName = profile.full_name.trim();
      }

      if (clientName === "Kliente" && event.email) {
        const { data: authRows, error: authError } = await supabase.auth.admin.listUsers({
          page: 1,
          perPage: 1000,
        });
        if (authError) throw authError;
        const matched = authRows.users.find(
          (u: any) => String(u.email ?? "").toLowerCase() === String(event.email).toLowerCase(),
        );
        if (matched) {
          const { data: profile, error: profileError } = await supabase
            .from("profiles")
            .select("full_name")
            .eq("id", matched.id)
            .maybeSingle();
          if (profileError) throw profileError;
          if (profile?.full_name?.trim()) clientName = profile.full_name.trim();
        }
      }

      let subject = "Svarbus Equus atnaujinimas";
      let html = "";

      if (event.event_type === "subscription_purchase") {
        if (!event.subscription_id) throw new Error("SUBSCRIPTION_MISSING");

        const { data: subscription, error: subscriptionError } = await supabase
          .from("subscriptions")
          .select("id,user_id,lessons_total,lessons_used,price,purchase_date,start_from_date,expires_at,paid,lesson_type,package_type,horse_type,purchase_method,purchased_at")
          .eq("id", event.subscription_id)
          .maybeSingle();

        if (subscriptionError) throw subscriptionError;
        if (!subscription) {
          await supabase.rpc("mark_email_event_failed", {
            _event_id: eventId,
            _error: "Subscription no longer exists",
            _retryable: false,
          });
          return json({ ok: false, processed: true, event_id: eventId, error: "SUBSCRIPTION_NOT_FOUND" }, 422);
        }

        let trainings: any[] = [];
        try {
          trainings = await getSubscriptionTrainingHistory(supabase, event.subscription_id);
        } catch (historyError) {
          throw new Error("SUBSCRIPTION_TRAINING_HISTORY_FAILED: " + describeError(historyError));
        }
        subject = "Jūsų Equus abonementas patvirtintas";
        html = subscriptionPurchaseHtml(clientName, subscription, trainings);
      }

      if (event.event_type === "subscription_expiring") {
        subject = "!SVARBU! Jūsų Equus abonementas netrukus baigsis";
        html = subscriptionExpiringHtml(clientName, event.payload || {});
      }

      if (event.event_type === "password_reset") {
        subject = "Equus slaptažodžio atkūrimas";
        html = passwordResetHtml(clientName, event.payload || {});
      }

      if (event.event_type === "global_important_update") {
        const payload = event.payload || {};
        subject = "!SVARBU! " + String(payload.title_lt || "Svarbus Equus atnaujinimas");
        html = globalAnnouncementHtml(clientName, payload);
      }

      const accessToken = await getGmailAccessToken();
      const { response: gmailResponse, data: gmailData } = await sendGmailEmail(
        accessToken,
        fromEmail,
        event.email,
        subject,
        html,
      );

      if (!gmailResponse.ok) {
        const details = JSON.stringify(gmailData);
        const retryable = gmailResponse.status >= 500 || gmailResponse.status === 429;
        await supabase.rpc("mark_email_event_failed", {
          _event_id: eventId,
          _error: `Gmail HTTP ${gmailResponse.status}: ${details}`,
          _retryable: retryable,
        });
        return json({
          ok: false,
          processed: true,
          event_id: eventId,
          error: "GMAIL_FAILED",
          retryable,
        }, 502);
      }

      const messageId = gmailData?.id ?? null;
      const { data: markedSent, error: sentError } = await supabase.rpc(
        "mark_email_event_sent",
        { _event_id: eventId, _resend_message_id: messageId },
      );

      if (sentError || !markedSent) {
        console.error("Email sent but DB state update failed:", sentError);
        return json({
          ok: false,
          processed: true,
          event_id: eventId,
          error: "EMAIL_SENT_DB_UPDATE_FAILED",
          message_id: messageId,
        }, 500);
      }

      console.log("Equus email sent:", {
        event_id: eventId,
        event_type: event.event_type,
        message_id: messageId,
      });

      return json({
        ok: true,
        processed: true,
        event_id: eventId,
        event_type: event.event_type,
        message_id: messageId,
      });
    } catch (error) {
      const message = describeError(error);
      await supabase.rpc("mark_email_event_failed", {
        _event_id: eventId,
        _error: message,
        _retryable: true,
      });
      console.error("send-subscription-email processing failed:", error);
      return json({ ok: false, processed: true, event_id: eventId, error: "PROCESSING_FAILED" }, 500);
    }
  } catch (error) {
    console.error("send-subscription-email failed:", error);
    return json({ error: "INTERNAL_ERROR" }, 500);
  }
});
