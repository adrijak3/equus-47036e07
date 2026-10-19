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
      <div style="margin-top:20px;padding:16px;border-radius:16px;background:#f7f4ee;border:1px solid #dfd7cb;">
        <div style="font-size:12px;letter-spacing:1.8px;text-transform:uppercase;color:#777568;">jūsų treniruotės</div>
        <p style="margin:8px 0 0;color:#777268;font-size:13px;line-height:1.6;">
          Kol kas šiame abonemente dar nėra užbaigtų treniruočių.
        </p>
      </div>`;
  }

  const rows = trainings.map((t) => `
    <tr>
      <td style="padding:9px 6px 9px 0;border-bottom:1px solid #e7e1d7;color:#454239;white-space:nowrap;">
        ${esc(formatDate(t.slot_date))}
        ${t.slot_time ? `<br><span style="font-size:12px;color:#969084;">${esc(formatTime(t.slot_time))}</span>` : ""}
      </td>
      <td style="padding:9px 6px;border-bottom:1px solid #e7e1d7;color:#454239;">
        ${esc(lessonKindLabel(t.lesson_kind, t.is_individual))}
      </td>
      <td style="padding:9px 0 9px 6px;border-bottom:1px solid #e7e1d7;color:#454239;text-align:right;">
        ${esc(t.horse_name || "—")}
      </td>
    </tr>`).join("");

  return `
    <div style="margin-top:20px;padding:18px;border-radius:16px;background:#f7f4ee;border:1px solid #dfd7cb;">
      <div style="font-size:12px;letter-spacing:1.8px;text-transform:uppercase;color:#777568;">Treniruotės šiame abonemente</div>
      <table style="width:100%;border-collapse:collapse;margin-top:10px;font-size:13px;">
        <thead>
          <tr>
            <th style="padding:7px 6px 7px 0;text-align:left;color:#827c70;font-size:11px;font-weight:700;">Data</th>
            <th style="padding:7px 6px;text-align:left;color:#827c70;font-size:11px;font-weight:700;">Treniruotė</th>
            <th style="padding:7px 0 7px 6px;text-align:right;color:#827c70;font-size:11px;font-weight:700;">Žirgas</th>
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

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function normalizeRecipientEmail(email: string): string {
  const trimmed = email.trim().toLowerCase();
  if (/@gmail\.gom$/i.test(trimmed)) {
    return trimmed.replace(/@gmail\.gom$/i, "@gmail.com");
  }
  return trimmed;
}

async function sendGmailEmail(
  accessToken: string,
  from: string,
  to: string,
  subject: string,
  html: string,
  imageUrl?: string | null,
) {
  let message: string;

  if (imageUrl) {
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      throw new Error(`GLOBAL_ANNOUNCEMENT_IMAGE_FETCH_FAILED: HTTP ${imageResponse.status}`);
    }

    const contentType = imageResponse.headers.get("content-type")?.split(";")[0] || "image/jpeg";
    if (!contentType.startsWith("image/")) {
      throw new Error("GLOBAL_ANNOUNCEMENT_IMAGE_INVALID_CONTENT_TYPE");
    }

    const extension = contentType.split("/")[1] || "jpeg";
    const filename = `equus-pranesimas.${extension === "jpeg" ? "jpg" : extension}`;
    const imageBase64 = arrayBufferToBase64(await imageResponse.arrayBuffer());
    const mixedBoundary = `equus-mixed-${crypto.randomUUID()}`;
    const relatedBoundary = `equus-related-${crypto.randomUUID()}`;

    const htmlWithImage = html.replace(
      "</body>",
      `<div style="margin:20px 0 0;text-align:center;"><img src="cid:equus-announcement-image" alt="Equus pranešimo nuotrauka" style="display:block;max-width:100%;height:auto;margin:0 auto;border-radius:14px;"></div></body>`,
    );

    message = [
      `From: ${from}`,
      `To: ${to}`,
      `Subject: ${encodeMimeHeader(subject)}`,
      "MIME-Version: 1.0",
      `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
      "",
      `--${mixedBoundary}`,
      `Content-Type: multipart/related; boundary="${relatedBoundary}"`,
      "",
      `--${relatedBoundary}`,
      "Content-Type: text/html; charset=UTF-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      htmlWithImage,
      `--${relatedBoundary}`,
      `Content-Type: ${contentType}; name="${filename}"`,
      "Content-ID: <equus-announcement-image>",
      "Content-Disposition: inline",
      "Content-Transfer-Encoding: base64",
      "",
      imageBase64,
      `--${relatedBoundary}--`,
      `--${mixedBoundary}`,
      `Content-Type: ${contentType}; name="${filename}"`,
      `Content-Disposition: attachment; filename="${filename}"`,
      "Content-Transfer-Encoding: base64",
      "",
      imageBase64,
      `--${mixedBoundary}--`,
      "",
    ].join("\r\n");
  } else {
    message = [
      `From: ${from}`,
      `To: ${to}`,
      `Subject: ${encodeMimeHeader(subject)}`,
      "MIME-Version: 1.0",
      "Content-Type: text/html; charset=UTF-8",
      "",
      html,
    ].join("\r\n");
  }

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

function emailShell(title: string, subtitle: string, inner: string) {
  return `
<!doctype html>
<html lang="lt">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Equus</title>
</head>
<body style="margin:0;background:#f5f2ec;color:#35342e;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:26px 14px;">
    <div style="background:linear-gradient(145deg,#f0e9dd,#e7dfd1);border:1px solid #dcd2c3;border-radius:18px;padding:24px 24px 21px;">
      <div style="font-size:11px;letter-spacing:2.5px;text-transform:uppercase;color:#6a6b5e;font-weight:700;">♞ &nbsp; Equus Jojimo Mokykla</div>
      <h1 style="margin:12px 0 7px;font-size:27px;line-height:1.25;font-weight:600;color:#35342e;">${esc(title)}</h1>
      <p style="margin:0;color:#69665c;font-size:14px;line-height:1.65;">${esc(subtitle)}</p>
    </div>
    <div style="margin-top:12px;background:#fffdfa;border:1px solid #e2dbd0;border-radius:16px;padding:22px 22px;box-shadow:0 5px 20px rgba(55,48,38,.04);">
      ${inner}
      <p style="margin:22px 0 0;padding-top:16px;border-top:1px solid #e7e1d7;color:#68645a;font-size:12px;line-height:1.65;">
        Turite klausimų? Parašykite mums: <a href="mailto:equusjojimomokykla@gmail.com" style="color:#555b4d;text-decoration:underline;">equusjojimomokykla@gmail.com</a>
      </p>
    </div>
    <p style="margin:18px 4px 0;color:#827c70;font-size:11px;line-height:1.6;text-align:center;">
      Laišką gavote iš Equus Jojimo Mokyklos sistemos.
    </p>
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
    <p style="margin:0 0 18px;font-size:15px;line-height:1.6;">Sveiki, ${esc(clientName)}! jūsų abonementas paruoštas. Žemiau rasite jo informaciją.</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <tr><td style="padding:8px 0;color:#777268;">Pamokos</td><td style="padding:8px 0;text-align:right;font-weight:600;">${esc(subscription.lessons_total)}</td></tr>
      <tr><td style="padding:8px 0;color:#777268;">Tipas</td><td style="padding:8px 0;text-align:right;font-weight:600;">${esc(packageLabel(subscription.package_type))}</td></tr>
      <tr><td style="padding:8px 0;color:#777268;">Žirgai</td><td style="padding:8px 0;text-align:right;font-weight:600;">${esc(horseLabel(subscription.horse_type))}</td></tr>
      <tr><td style="padding:8px 0;color:#777268;">Sumokėta</td><td style="padding:8px 0;text-align:right;font-weight:600;">${formatEur(subscription.price)}</td></tr>
      <tr><td style="padding:8px 0;color:#777268;">Pirkimo data</td><td style="padding:8px 0;text-align:right;font-weight:600;">${formatDate(subscription.purchase_date)}</td></tr>
      <tr><td style="padding:8px 0;color:#777268;">Galioja iki</td><td style="padding:8px 0;text-align:right;font-weight:600;">${formatDate(subscription.expires_at)}</td></tr>
    </table>
    <div style="margin-top:18px;padding:16px;border-radius:14px;background:#f0ebe2;text-align:center;">
      <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#777568;">Liko pamokų</div>
      <div style="font-size:40px;font-weight:700;color:#393a34;margin-top:5px;">${remaining}</div>
      <div style="font-size:13px;color:#777268;">${Number(subscription.lessons_used ?? 0)} panaudota iš ${Number(subscription.lessons_total)}</div>
    </div>
    ${trainingHistoryHtml(trainings)}
    <div style="margin-top:20px;padding:14px 16px;border-radius:14px;background:#eee7db;border:1px solid #d9d0c2;text-align:center;color:#69645a;font-size:13px;line-height:1.6;">
      Ačiū, kad jodinėjate su Equus. Iki susitikimo žirgyne!
    </div>`;
  return emailShell("Abonementas patvirtintas", "Abonemento informacija", inner);
}

function subscriptionExpiringHtml(clientName: string, payload: any) {
  const lastTraining = payload?.last_training_date
    ? formatDate(payload.last_training_date)
    : null;
  const lastTrainingTime = payload?.last_training_time
    ? formatTime(payload.last_training_time)
    : null;
  const expiresAt = payload?.expires_at ? formatDate(payload.expires_at) : null;
  const remaining = Number(payload?.remaining ?? 1);

  const finalTrainingText = lastTraining
    ? `Liko viena įskaičiuota treniruotė. Ji šiuo metu suplanuota ${lastTraining}${lastTrainingTime ? ` ${lastTrainingTime}` : ""}.`
    : "Liko viena įskaičiuota treniruotė, tačiau šiuo metu jai nėra priskirtos būsimos rezervacijos.";

  const inner = `
    <p style="margin:0;font-size:15px;line-height:1.7;">Sveiki, ${esc(clientName)}!</p>
    <p style="margin:10px 0 0;font-size:15px;line-height:1.7;">
      Mažas priminimas: jūsų abonemente <strong>liko ${remaining} treniruotė</strong>.
    </p>
    <div style="margin-top:20px;padding:18px;border-radius:16px;background:#f0ebe2;border:1px solid #dfd7cb;">
      <div style="font-size:12px;letter-spacing:1.8px;text-transform:uppercase;color:#777568;">Liko abonemente</div>
      <div style="font-size:25px;font-weight:700;color:#393a34;margin-top:6px;">1 treniruotė</div>
      <div style="font-size:13px;color:#777268;margin-top:7px;line-height:1.6;">
        ${esc(finalTrainingText)}
      </div>
      ${expiresAt ? `<div style="font-size:13px;color:#777268;margin-top:5px;">Abonementas galioja iki ${esc(expiresAt)}.</div>` : ""}
    </div>
    <p style="margin:18px 0 0;color:#686258;font-size:14px;line-height:1.7;">
      Jei norėsite tęsti treniruotes, kitu abonementu galite pasirūpinti iš anksto.
    </p>`;
  return emailShell("Liko 1 treniruotė abonemente", "Trumpas priminimas apie abonemento likutį", inner);
}

function globalAnnouncementHtml(clientName: string, payload: any) {
  const titleLt = String(payload?.title_lt || "Svarbus Equus atnaujinimas");
  const titleEn = String(payload?.title_en || "Important Equus update");
  const bodyLt = String(payload?.body_lt || "");
  const bodyEn = String(payload?.body_en || "");
  const url = String(payload?.url || "/grafikas");
  const inner = `
    <p style="margin:0 0 18px;font-size:15px;line-height:1.6;">Sveiki, ${esc(clientName)}!</p>
    <div style="padding:16px 18px;border-radius:15px;background:#f0ebe2;border:1px solid #dfd7cb;">
      <h2 style="margin:0;color:#393a34;font-size:20px;">${esc(titleLt)}</h2>
      <p style="margin:10px 0 0;white-space:pre-wrap;font-size:15px;line-height:1.7;">${esc(bodyLt)}</p>
    </div>
    <div style="margin-top:18px;padding-top:18px;border-top:1px solid #e4ddd2;">
      <h3 style="margin:0;color:#393a34;font-size:16px;">${esc(titleEn)}</h3>
      <p style="margin:8px 0 0;white-space:pre-wrap;color:#686258;font-size:14px;line-height:1.7;">${esc(bodyEn)}</p>
    </div>
    <div style="margin-top:20px;text-align:center;">
      <a href="https://equusjm.pages.dev${url.startsWith("/") ? url : "/" + url}"
         style="display:inline-block;padding:12px 20px;border-radius:999px;background:#5b6153;color:#fff;text-decoration:none;font-weight:700;">
        Atidaryti Equus / Open Equus
      </a>
    </div>`;
  return emailShell(titleLt, "Naujiena iš Equus", inner);
}


function subscriptionRequirementWarningHtml(clientName: string, payload: any) {
  const bookingDate = formatDate(payload?.booking_date);
  const bookingTime = formatTime(payload?.booking_time);
  const deadline = formatDate(payload?.deadline);
  const inner = `
    <p style="margin:0;font-size:15px;line-height:1.7;">Sveiki, ${esc(clientName)}!</p>
    <p style="margin:10px 0 0;font-size:15px;line-height:1.7;">
      jūsų artimiausia treniruotė yra <strong>${esc(bookingDate)} ${esc(bookingTime)}</strong>.
    </p>
    <div style="margin-top:20px;padding:18px;border-radius:16px;background:#f0ebe2;border:1px solid #dfd7cb;">
      <div style="font-size:12px;letter-spacing:1.8px;text-transform:uppercase;color:#777568;">Iki kada įsigyti abonementą</div>
      <div style="font-size:25px;font-weight:700;color:#393a34;margin-top:6px;">${esc(deadline)} · 20:00</div>
      <div style="font-size:13px;color:#777268;margin-top:6px;line-height:1.6;">
        Abonementą reikėtų įsigyti iki šio laiko. Jei iki tol jo neįsigysite, vėlesnės nuolatinės rezervacijos bus laikinai sustabdytos.
      </div>
    </div>
    <p style="margin:18px 0 0;color:#686258;font-size:14px;line-height:1.7;">
      Viena artimiausia rezervacija gali likti ir be abonemento. Įsigijus naują abonementą, ją bus galima jam priskirti.
    </p>`;
  return emailShell("Abonementas reikalingas", "Priminimas apie būsimą treniruotę", inner);
}

function passwordResetHtml(clientName: string, payload: any) {
  const recoveryCode = String(payload?.recovery_code || "");
  const resetUrl = String(payload?.reset_url || "");
  const action = recoveryCode
    ? '<div style="margin:24px 0;padding:20px 12px;border-radius:16px;background:#f0ebe2;border:1px solid #dfd7cb;text-align:center;"><div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#777568;">jūsų vienkartinis kodas</div><div style="font-size:34px;letter-spacing:8px;font-weight:700;color:#393a34;margin-top:10px;">' + esc(recoveryCode) + '</div><p style="margin:12px 0 0;color:#777268;font-size:12px;">Įveskite šį kodą Equus slaptažodžio atkūrimo puslapyje.</p></div>'
    : '<div style="margin:24px 0;text-align:center;"><a href="' + esc(resetUrl) + '" style="display:inline-block;padding:13px 24px;border-radius:999px;background:#5b6153;color:#fff;text-decoration:none;font-weight:700;">Nustatyti naują slaptažodį</a></div>';
  const inner =
    '<p style="margin:0 0 18px;font-size:15px;line-height:1.7;">Sveiki, ' +
    esc(clientName) +
    '!</p>' +
    '<p style="margin:0;font-size:15px;line-height:1.7;">Gavome prašymą pakeisti Equus paskyros slaptažodį.</p>' +
    (recoveryCode
      ? '<p style="margin:10px 0 0;color:#686258;font-size:14px;line-height:1.7;">Naudokite žemiau pateiktą vienkartinį kodą, kad patvirtintumėte savo el. paštą ir pasirinktumėte naują slaptažodį.</p>'
      : '<p style="margin:10px 0 0;color:#686258;font-size:14px;line-height:1.7;">Paspauskite žemiau esantį mygtuką ir nustatykite naują slaptažodį. Ši nuoroda skirta tik Jums ir yra vienkartinė.</p>') +
    action +
    '<p style="margin:0;color:#827c70;font-size:12px;line-height:1.7;">Jei šio prašymo nepateikėte, tiesiog ignoruokite šį laišką.</p>';
  return emailShell("Slaptažodžio atkūrimas", "Equus paskyros slaptažodžio atkūrimas", inner);
}

async function getSubscriptionTrainingHistory(supabase: any, subscriptionId: string) {
  const { data: bookings, error: bookingsError } = await supabase
    .from("bookings")
    .select("id,slot_date,slot_time,status,is_individual")
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

  // lesson_kind is not a physical bookings column. The app derives it from
  // is_individual + the slot capacity: capacity 1–2 = po2, 3+ = group.
  // Use the same rule here so the email worker does not depend on a
  // non-existent database column.
  const { data: timeSlots, error: timeSlotsError } = await supabase
    .from("time_slots")
    .select("day_of_week,slot_time,max_capacity")
    .eq("active", true)
    .is("one_off_date", null);
  if (timeSlotsError) throw timeSlotsError;

  const dates = Array.from(new Set(rows.map((b: any) => String(b.slot_date))));
  const { data: overrides, error: overridesError } = await supabase
    .from("slot_overrides")
    .select("slot_date,slot_time,max_capacity")
    .in("slot_date", dates);
  if (overridesError) throw overridesError;

  const dayOfWeek = (date: string) => {
    const d = new Date(`${date}T12:00:00`);
    const jsDay = d.getDay();
    return jsDay === 0 ? 7 : jsDay;
  };

  const capacityFor = (date: string, time: string) => {
    const override = (overrides ?? []).find(
      (x: any) => String(x.slot_date) === date && String(x.slot_time) === time,
    );
    if (override) return Number(override.max_capacity);

    const dow = dayOfWeek(date);
    const slot = (timeSlots ?? []).find(
      (x: any) => Number(x.day_of_week) === dow && String(x.slot_time) === time,
    );
    return slot ? Number(slot.max_capacity) : null;
  };

  return rows.map((b: any) => {
    const capacity = capacityFor(String(b.slot_date), String(b.slot_time));
    const lesson_kind = b.is_individual
      ? "individual"
      : capacity !== null && capacity <= 2
        ? "po2"
        : "group";

    return {
      ...b,
      lesson_kind,
      horse_name: horseByBooking.get(b.id) ?? "—",
    };
  });
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

    const processOneEmail = async () => {
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

    // An exemption may have been added after this warning was queued.
    // Re-check at send time so an already-pending warning cannot slip through.
    if (event.event_type === "subscription_requirement_warning" && event.user_id) {
      const { data: isExempt, error: exemptionError } = await supabase.rpc(
        "is_subscription_rule_exempt",
        { _user_id: event.user_id },
      );
      if (exemptionError) throw exemptionError;

      if (isExempt === true) {
        const { error: skipError } = await supabase
          .from("email_events")
          .update({
            status: "skipped",
            last_error: "Skipped: user is exempt from subscription requirements.",
            processing_started_at: null,
          })
          .eq("id", eventId)
          .eq("status", "processing");
        if (skipError) throw skipError;

        console.log("Equus subscription warning skipped for exempt user:", {
          event_id: eventId,
          user_id: event.user_id,
        });
        return json({
          ok: true,
          processed: true,
          skipped: true,
          event_id: eventId,
          reason: "USER_EXEMPT_FROM_SUBSCRIPTION_REQUIREMENT",
        });
      }
    }

    try {
      let recipientEmail = normalizeRecipientEmail(String(event.email ?? ""));

      if (event.user_id) {
        const { data: authUser, error: authUserError } = await supabase.auth.admin.getUserById(event.user_id);
        if (authUserError) throw authUserError;
        if (authUser.user?.email) {
          recipientEmail = normalizeRecipientEmail(authUser.user.email);
        }
      }

      if (!recipientEmail) {
        await supabase.rpc("mark_email_event_failed", {
          _event_id: eventId,
          _error: "Email address is missing",
          _retryable: false,
        });
        return json({ ok: false, processed: true, event_id: eventId, error: "EMAIL_MISSING" }, 422);
      }

      if (!["subscription_purchase", "subscription_expiring", "global_important_update", "password_reset", "subscription_requirement_warning"].includes(event.event_type)) {
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

      if (clientName === "Kliente" && recipientEmail) {
        const { data: authRows, error: authError } = await supabase.auth.admin.listUsers({
          page: 1,
          perPage: 1000,
        });
        if (authError) throw authError;
        const matched = authRows.users.find(
          (u: any) => normalizeRecipientEmail(String(u.email ?? "")) === recipientEmail,
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
        subject = "Equus abonementas patvirtintas";
        html = subscriptionPurchaseHtml(clientName, subscription, trainings);
      }

      if (event.event_type === "subscription_expiring") {
        subject = "!SVARBU! Abonementas netrukus baigsis";
        html = subscriptionExpiringHtml(clientName, event.payload || {});
      }

      if (event.event_type === "subscription_requirement_warning") {
        subject = "!SVARBU! Reikia abonemento prieš kitą treniruotę";
        html = subscriptionRequirementWarningHtml(clientName, event.payload || {});
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
        recipientEmail,
        subject,
        html,
        event.event_type === "global_important_update" ? String(event.payload?.image_url || "") || null : null,
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

    };

    const results: unknown[] = [];

    for (let i = 0; i < 10; i += 1) {
      try {
        const response = await processOneEmail();
        const payload = await response.json();
        results.push(payload);

        if (payload?.reason === "NO_PENDING_EVENTS") {
          break;
        }
      } catch (error) {
        console.error("send-subscription-email batch item failed:", error);
        results.push({
          ok: false,
          processed: false,
          error: "BATCH_ITEM_FAILED",
          details: describeError(error),
        });
      }
    }

    const processedCount = results.filter((result: any) => result?.processed === true).length;
    const sentCount = results.filter((result: any) => result?.ok === true && result?.processed === true && result?.skipped !== true).length;

    return json({
      ok: true,
      processed: processedCount,
      sent: sentCount,
      attempted: results.length,
      results,
    });
  } catch (error) {
    console.error("send-subscription-email failed:", error);
    return json({ error: "INTERNAL_ERROR" }, 500);
  }
});
