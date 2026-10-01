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

function paymentLabel(value: string | null | undefined) {
  if (value === "cash") return "Grynais";
  if (value === "bank_transfer") return "Bankiniu pavedimu";
  if (value === "other") return "Kita";
  return value || "—";
}

function horseLabel(value: string | null | undefined) {
  if (value === "school") return "Mokyklos žirgais";
  if (value === "own") return "Nuosavais žirgais";
  if (value === "private") return "Nuosavais žirgais";
  return value || "—";
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

function base64UrlEncode(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function encodeMimeHeader(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `=?UTF-8?B?${btoa(binary)}?=`;
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  }

  // This worker is invoked by pg_cron/pg_net, not by a browser user.
  // The endpoint is deployed without Supabase JWT verification, so it must
  // validate the server-to-server cron secret itself.
  const expectedCronSecret = Deno.env.get("EQUUS_CRON_SECRET");
  const suppliedCronSecret = req.headers.get("x-equus-cron-secret");
  if (!expectedCronSecret || !suppliedCronSecret || suppliedCronSecret !== expectedCronSecret) {
    return json({ error: "UNAUTHORIZED" }, 401);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const fromEmail =
      Deno.env.get("GMAIL_FROM_EMAIL") ||
      "Equus Jojimo Mokykla <equusjojimomokykla@gmail.com>";

    if (!supabaseUrl || !serviceRoleKey) {
      console.error("Missing server configuration");
      return json({ error: "SERVER_CONFIGURATION_ERROR" }, 500);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // First return abandoned jobs to the queue.
    const { error: recoveryError } = await supabase.rpc(
      "recover_stale_email_events",
      { _stale_after: "15 minutes" },
    );

    if (recoveryError) {
      console.error("Failed to recover stale email events:", recoveryError);
      return json({ error: "QUEUE_RECOVERY_FAILED" }, 500);
    }

    // Claim exactly one event. The DB function uses FOR UPDATE SKIP LOCKED.
    const { data: claimed, error: claimError } = await supabase.rpc(
      "claim_email_event",
    );

    if (claimError) {
      console.error("Failed to claim email event:", claimError);
      return json({ error: "QUEUE_CLAIM_FAILED" }, 500);
    }

    const event = Array.isArray(claimed) ? claimed[0] : claimed;

    if (!event) {
      return json({ ok: true, processed: false, reason: "NO_PENDING_EVENTS" });
    }

    const eventId = event.id as string;
    const eventType = event.event_type as string;

    try {
      if (eventType !== "subscription_purchase") {
        await supabase.rpc("mark_email_event_failed", {
          _event_id: eventId,
          _error: `Unsupported event type: ${eventType}`,
          _retryable: false,
        });
        return json({ ok: false, processed: true, event_id: eventId, error: "UNSUPPORTED_EVENT_TYPE" }, 422);
      }

      if (!event.email) {
        await supabase.rpc("mark_email_event_failed", {
          _event_id: eventId,
          _error: "Email address is missing",
          _retryable: false,
        });
        return json({ ok: false, processed: true, event_id: eventId, error: "EMAIL_MISSING" }, 422);
      }

      if (!event.subscription_id) {
        await supabase.rpc("mark_email_event_failed", {
          _event_id: eventId,
          _error: "Subscription ID is missing",
          _retryable: false,
        });
        return json({ ok: false, processed: true, event_id: eventId, error: "SUBSCRIPTION_MISSING" }, 422);
      }

      const { data: subscription, error: subscriptionError } = await supabase
        .from("subscriptions")
        .select(
          "id,user_id,lessons_total,lessons_used,price,purchase_date,start_from_date,expires_at,paid,lesson_type,package_type,horse_type,purchase_method,purchased_at",
        )
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

      const remaining = Math.max(
        0,
        Number(subscription.lessons_total) - Number(subscription.lessons_used ?? 0),
      );

      const subject = "Jūsų Equus abonementas patvirtintas 🐎";

      const html = `
<!doctype html>
<html lang="lt">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Equus abonementas</title>
</head>
<body style="margin:0;background:#f6f3ee;color:#28231f;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:620px;margin:0 auto;padding:32px 16px;">
    <div style="background:#171513;border-radius:22px;padding:28px 30px;color:#fff;">
      <div style="font-size:12px;letter-spacing:3px;text-transform:uppercase;color:#d6b56a;">
        Equus Jojimo Mokykla
      </div>
      <h1 style="margin:12px 0 6px;font-size:28px;line-height:1.2;font-weight:600;">
        Abonementas patvirtintas 🐎
      </h1>
      <p style="margin:0;color:#ddd5cb;font-size:15px;line-height:1.6;">
        Sveiki, ${esc(clientName)}! Jūsų abonemento pirkimas sėkmingai užregistruotas.
      </p>
    </div>

    <div style="margin-top:14px;background:#fff;border:1px solid #e4ddd3;border-radius:18px;padding:24px 26px;">
      <h2 style="margin:0 0 18px;font-size:18px;">Abonemento informacija</h2>

      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <tr>
          <td style="padding:9px 0;color:#756d65;">Pamokos</td>
          <td style="padding:9px 0;text-align:right;font-weight:600;">${esc(subscription.lessons_total)}</td>
        </tr>
        <tr>
          <td style="padding:9px 0;color:#756d65;">Tipas</td>
          <td style="padding:9px 0;text-align:right;font-weight:600;">${esc(packageLabel(subscription.package_type))}</td>
        </tr>
        <tr>
          <td style="padding:9px 0;color:#756d65;">Žirgai</td>
          <td style="padding:9px 0;text-align:right;font-weight:600;">${esc(horseLabel(subscription.horse_type))}</td>
        </tr>
        <tr>
          <td style="padding:9px 0;color:#756d65;">Sumokėta</td>
          <td style="padding:9px 0;text-align:right;font-weight:600;">${formatEur(subscription.price)}</td>
        </tr>
        <tr>
          <td style="padding:9px 0;color:#756d65;">Pirkimo data</td>
          <td style="padding:9px 0;text-align:right;font-weight:600;">${formatDate(subscription.purchase_date)}</td>
        </tr>
        <tr>
          <td style="padding:9px 0;color:#756d65;">Galioja iki</td>
          <td style="padding:9px 0;text-align:right;font-weight:600;">${formatDate(subscription.expires_at)}</td>
        </tr>
      </table>
    </div>

    <div style="margin-top:14px;background:#fff;border:1px solid #e4ddd3;border-radius:18px;padding:24px 26px;text-align:center;">
      <div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#8b7a5c;">
        Liko pamokų
      </div>
      <div style="font-size:44px;line-height:1.1;font-weight:700;margin-top:8px;">
        ${remaining}
      </div>
      <p style="margin:8px 0 0;color:#756d65;font-size:13px;">
        ${Number(subscription.lessons_used ?? 0)} panaudota iš ${Number(subscription.lessons_total)}
      </p>
    </div>

    <p style="margin:22px 4px 0;color:#756d65;font-size:12px;line-height:1.6;text-align:center;">
      Šis laiškas išsiųstas automatiškai iš Equus Jojimo Mokyklos sistemos.
    </p>
  </div>
</body>
</html>`;

      const accessToken = await getGmailAccessToken();
      const { response: gmailResponse, data: gmailData } =
        await sendGmailEmail(
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
        {
          _event_id: eventId,
          _resend_message_id: messageId,
        },
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

      console.log("Subscription email sent:", {
        event_id: eventId,
        subscription_id: subscription.id,
        message_id: messageId,
      });

      return json({
        ok: true,
        processed: true,
        event_id: eventId,
        subscription_id: subscription.id,
        message_id: messageId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      await supabase.rpc("mark_email_event_failed", {
        _event_id: eventId,
        _error: message,
        _retryable: true,
      });

      console.error("send-subscription-email processing failed:", error);

      return json({
        ok: false,
        processed: true,
        event_id: eventId,
        error: "PROCESSING_FAILED",
      }, 500);
    }
  } catch (error) {
    console.error("send-subscription-email failed:", error);
    return json({ error: "INTERNAL_ERROR" }, 500);
  }
});
