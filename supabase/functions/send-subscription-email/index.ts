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
  if (value === "individual") return "Individualios pamokos";
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
      <div style="margin-top:20px;padding:16px;border-radius:16px;background:#f7f4ee;border:1px solid #E9DDEE;">
        <div style="font-size:12px;letter-spacing:1.8px;text-transform:uppercase;color:#795E8B;">jūsų treniruotės</div>
        <p style="margin:8px 0 0;color:#786782;font-size:13px;line-height:1.6;">
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
    <div style="margin-top:20px;padding:18px;border-radius:16px;background:#f7f4ee;border:1px solid #E9DDEE;">
      <div style="font-size:12px;letter-spacing:1.8px;text-transform:uppercase;color:#795E8B;">Treniruotės šiame abonemente</div>
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
  attachmentBaseName?: string | null,
  replyTo?: string | null,
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
    const filename = `${attachmentBaseName && /^dovanu_kuponas_equus_[a-zA-Z0-9_]{1,80}$/.test(attachmentBaseName) ? attachmentBaseName : "equus-pranesimas"}.${extension === "jpeg" ? "jpg" : extension}`;
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
      ...(replyTo ? [`Reply-To: ${replyTo}`] : []),
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
      ...(replyTo ? [`Reply-To: ${replyTo}`] : []),
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
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Equus jojimo mokykla</title>
<style>
@media only screen and (max-width:620px) {
  .outer { padding:16px 10px !important; }
  .email-card { padding:24px 21px !important; }
  .email-head { padding:25px 21px !important; }
  .email-title { font-size:25px !important; }
}
</style>
</head>
<body style="margin:0;padding:0;background:#F7F4FA;color:#33283E;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;">
<div class="outer" style="max-width:600px;margin:0 auto;padding:34px 16px;">
  <div style="text-align:center;margin:0 0 18px;font-size:12px;letter-spacing:2px;font-weight:700;color:#755B88;">EQUUS <span style="font-weight:400;">JOJIMO MOKYKLA</span></div>
  <div style="overflow:hidden;border:1px solid #E8DEEF;border-radius:18px;background:#FFFFFF;">
    <div class="email-head" style="background:#F0E8F5;padding:30px 32px;border-bottom:1px solid #E8DEEF;">
      <img src="https://equusjm.pages.dev/equus-logo-black.png" width="64" height="64" alt="Equus" style="display:block;width:64px;height:64px;border:0;border-radius:50%;margin:0 0 20px;background:#17111B;" />
      <h1 class="email-title" style="font-family:Arial,Helvetica,sans-serif;font-weight:700;font-size:29px;line-height:1.2;letter-spacing:-.5px;color:#4C315D;margin:0 0 10px;">${esc(title)}</h1>
      <p style="margin:0;font-size:14px;line-height:1.6;color:#765F83;">${esc(subtitle)}</p>
    </div>
    <div class="email-card" style="padding:30px 32px 28px;background:#FFFFFF;font-size:15px;line-height:1.7;color:#43364C;">
      ${inner}
      <div style="height:1px;background:#EEE7F1;margin:27px 0 18px;"></div>
      <p style="margin:0;font-size:13px;line-height:1.7;color:#776A7F;">Turite klausimų? Parašykite mums:<br><a href="mailto:equusjojimomokykla@gmail.com" style="font-weight:600;color:#70498A;text-decoration:underline;">equusjojimomokykla@gmail.com</a></p>
    </div>
  </div>
  <div style="padding:18px 6px 0;text-align:center;color:#8A7B90;font-size:12px;line-height:1.6;">Equus jojimo mokykla · Iki susitikimo žirgyne!</div>
</div>
</body></html>`;
}

function welcomeEmailHtml(clientName: string) {
  const section = (number: string, heading: string, content: string) => `
    <section style="margin:28px 0 0;padding-top:20px;border-top:1px solid #EEE7F1;">
      <h2 style="margin:0 0 12px;font-size:19px;font-weight:600;color:#563769;line-height:1.35;">${number ? `${number}. ` : ""}${heading}</h2>
      ${content}
    </section>`;
  const link = (href: string, label: string) => `<a href="${href}" style="color:#70498A;font-weight:700;text-decoration:underline;">${label}</a>`;
  const bullets = (items: string[]) => `<ul style="padding-left:20px;margin:10px 0 0;">${items.map((item) => `<li style="margin:8px 0;">${item}</li>`).join("")}</ul>`;

  const inner = `
    <p style="margin:0 0 12px;">Sveiki, ${esc(clientName)}! 💙</p>
    <p>Džiaugiamės, kad prisijungėte prie <strong>Equus jojimo mokyklos!</strong> 🐴</p>
    <p>Kad Jūsų pirmieji žingsniai mūsų sistemoje būtų kuo paprastesni, paruošėme trumpą svarbiausios informacijos atmintinę.</p>
    <p>Žemiau rasite viską, ką verta žinoti apie treniruotes, abonementus, registraciją ir pagrindines taisykles.</p>
    ${section("1", "🐴 Jojimo paslaugų sutartis", `
      <p><strong>Prieš pirmąją treniruotę kiekvienas raitelis privalo pasirašyti jojimo paslaugų sutartį.</strong></p>
      <p>Ši taisyklė galioja visiems – tiek vaikams, tiek suaugusiesiems, nepriklausomai nuo jojimo patirties ar pasirinkto treniruotės tipo. („Mažylio svajonė“ ir fotosesijoms pasirašoma laisvalaikio jojimo sutartis.)</p>
      <p>Sutartį rasite čia: ${link("https://equusjm.pages.dev/jojimo-paslaugu-sutartis-equus.pdf", "Peržiūrėti jojimo paslaugų sutartį")}</p>
      <p>Be pasirašytos sutarties treniruotėje dalyvauti negalima.</p>`)}
    ${section("2", "💙 Abonementai", `
      <p>Equus treniruotes galite lankyti įsigiję abonementą.</p>
      <p>Svarbiausia, ką reikėtų žinoti:</p>
      ${bullets([
        "Galite rinktis 4, 8 arba 12 treniruočių abonementą arba nestandartinį treniruočių skaičių (pvz., 6, 9, 14 ir kt.).",
        "<strong>Vienas abonementas gali būti naudojamas treniruotėms su skirtingais Equus treneriais.</strong> Kiekvienam treneriui atskiro abonemento pirkti nereikia (išskyrus Jovitos treniruotes).",
        "Abonementas galioja 30 dienų nuo jo pradžios.",
        "Jei įsigyjate naują abonementą, o ankstesniajame dar liko nepanaudotų treniruočių, naujasis pradės galioti tik pasibaigus ankstesniajam.",
        "Jei ankstesnio abonemento treniruotės jau išnaudotos, naujasis pradeda galioti jo įsigijimo dieną.",
        "Skirtingų tipų treniruotėms gali būti taikomos priemokos.",
        "Jeigu dėl asmeninių priežasčių abonemento įsigyti negalite ir norite už kiekvieną pamoką mokėti atskirai, <strong>susisiekite – aptarsime galimybes individualiai.</strong>",
      ])}
      <h3 style="font-size:16px;color:#563769;margin:22px 0 8px;">Kaip įsigyti abonementą?</h3>
      <p>Prisijunkite prie savo paskyros ir pasirinkite <strong>„Pateikti abonemento užklausą“</strong>.</p>
      <p>Ten galėsite pasirinkti abonemento tipą, treniruočių skaičių ir atsiskaitymo būdą.</p>
      <p>Savo turimus abonementus, likusias treniruotes ir galiojimo datas visada galėsite matyti skiltyje „Mano abonementai“.</p>
      <h3 style="font-size:16px;color:#563769;margin:22px 0 8px;">Liga ir atostogos</h3>
      <p>Susirgus arba išvykus atostogų, abonemento galiojimas gali būti pratęstas pagal EQUUS taisykles.</p>
      <p>Apie ligą prašome informuoti administraciją, o planuojamas atostogas pažymėti savo paskyros skiltyje „Atostogos“.</p>`)}
    ${section("3", "📅 Registracija į treniruotes", `
      <p>Į treniruotes registruojamasi Equus internetiniame grafike.</p>
      <p>${link("https://equusjm.pages.dev/grafikas", "Atidaryti treniruočių grafiką")}</p>
      <p>Keletas svarbių dalykų:</p>
      ${bullets([
        "Grafike matomos einamoji ir ateinanti savaitės.",
        "Nauja savaitė registracijai atidaroma sekmadienį 01:00 val.",
        "Registruotis galima iki treniruotės pradžios.",
        "Neturint abonemento galima užsiregistruoti į vieną treniruotę. Norint registruotis į kitas, reikės galiojančio abonemento. Nuolatiniams laikams gali būti taikomos papildomos sąlygos.",
      ])}
      <p>Jeigu norite lankyti treniruotes reguliariai tuo pačiu savaitės laiku, dėl nuolatinio laiko susisiekite su administracija.</p>`)}
    ${section("4", "🐎 Žirgo pasirinkimas", `
      <p>Savo treniruotei žirgą galėsite pasirinkti tiesiogiai grafike. Ši galimybė labiau skirta raiteliams, kurie jau yra lankę bent kelias EQUUS treniruotes ir susipažinę su mūsų žirgais.</p>
      <p>Žirgo pasirinkimas atidaromas <strong>20:00 val. dieną prieš treniruotę</strong> ir uždaromas treniruotės dieną 21:00 val.</p>
      <p>Svarbu žinoti, kad žirgų pasirinkimas priklauso nuo jų užimtumo, darbo dienų ir leidžiamo krūvio. Prireikus treneris gali paskirti kitą tinkamą žirgą.</p>`)}
    ${section("5", "⏰ Treniruočių atšaukimas ir perkėlimas", `
      <p>Suprantame, kad planai kartais pasikeičia!</p>
      <p>Tačiau labai prašome laikytis šių taisyklių:</p>
      ${bullets([
        "<strong>Treniruotę galima atšaukti neprarandant pamokos likus bent 24 valandoms iki jos pradžios.</strong>",
        "Atšaukus vėliau arba neatvykus nepranešus, treniruotė paprastai laikoma panaudota.",
        "Ligos ar nenumatytų aplinkybių atvejai gali būti vertinami individualiai.",
        "Perkelti treniruotę galima tik į kitą tinkamą laisvą laiką, laikantis sistemoje nustatytų sąlygų.",
      ])}
      <p>Jei nepavyksta atšaukti ar perkelti treniruotės, susisiekite su mumis.</p>`)}
    ${section("6", "🤍 Prieš atvykstant į treniruotę", `
      <p>Keletas mažų priminimų:</p>
      ${bullets([
        "Atvykite apie 30 minučių prieš treniruotės pradžią, kad spėtumėte pasiruošti.",
        "Pasirūpinkite tinkama, patogia jojimo apranga ir avalyne.",
        "Treniruotės metu laikykitės trenerio nurodymų.",
        "Jeigu turite klausimų ar kyla neaiškumų, visada galite kreiptis.",
      ])}`)}
    ${section("", "💌 Turite klausimų?", `
      <p>Jeigu kažkas neveikia, nepavyksta užsiregistruoti, kyla klausimų dėl paskyros ar abonemento – drąsiai rašykite arba skambinkite!</p>
      <p><strong>EQUUS administracija – Adrija</strong></p>
      <p>📞 <a style="color:#70498A;" href="tel:+37062876090">+370 628 76090</a></p>
      <p>💬 <a style="color:#70498A;font-weight:700;" href="https://m.me/adriija.kalikaite">Parašyti per Messenger</a></p>
      <p>✉️ ${link("mailto:jojimomokykla@gmail.com", "jojimomokykla@gmail.com")}</p>
      <p>Visas išsamias taisykles rasite čia: ${link("https://equusjm.pages.dev/taisykles-ir-salygos", "Equus taisyklės ir sąlygos")}</p>`)}
    <p style="margin:28px 0 8px;font-weight:700;color:#563769;">Džiaugiamės, kad esate su mumis!</p>
    <p>Iki susitikimo žirgyne! 🐴💙</p>
    <p><strong>Equus jojimo mokykla 🤍</strong></p>`;

  return emailShell("Sveiki prisijungę prie Equus! 🐴 Susipažinkime!", "Jūsų svarbiausios informacijos atmintinė", inner);
}

function subscriptionPurchaseHtml(clientName: string, subscription: any, trainings: any[]) {
  const remaining = Math.max(
    0,
    Number(subscription.lessons_total) - Number(subscription.lessons_used ?? 0),
  );
  const inner = `
    <p style="margin:0 0 18px;font-size:15px;line-height:1.6;">Sveiki, ${esc(clientName)}! Jūsų abonementas paruoštas. Žemiau rasite jo informaciją.</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <tr><td style="padding:8px 0;color:#786782;">Pamokos</td><td style="padding:8px 0;text-align:right;font-weight:600;">${esc(subscription.lessons_total)}</td></tr>
      <tr><td style="padding:8px 0;color:#786782;">Tipas</td><td style="padding:8px 0;text-align:right;font-weight:600;">${esc(packageLabel(subscription.package_type))}</td></tr>
      <tr><td style="padding:8px 0;color:#786782;">Žirgai</td><td style="padding:8px 0;text-align:right;font-weight:600;">${esc(horseLabel(subscription.horse_type))}</td></tr>
      <tr><td style="padding:8px 0;color:#786782;">Sumokėta</td><td style="padding:8px 0;text-align:right;font-weight:600;">${formatEur(subscription.price)}</td></tr>
      <tr><td style="padding:8px 0;color:#786782;">Pirkimo data</td><td style="padding:8px 0;text-align:right;font-weight:600;">${formatDate(subscription.purchase_date)}</td></tr>
      <tr><td style="padding:8px 0;color:#786782;">Galioja iki</td><td style="padding:8px 0;text-align:right;font-weight:600;">${formatDate(subscription.expires_at)}</td></tr>
    </table>
    <div style="margin-top:18px;padding:16px;border-radius:14px;background:#F4EEF8;text-align:center;">
      <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#795E8B;">Liko pamokų</div>
      <div style="font-size:40px;font-weight:700;color:#563769;margin-top:5px;">${remaining}</div>
      <div style="font-size:13px;color:#786782;">${Number(subscription.lessons_used ?? 0)} panaudota iš ${Number(subscription.lessons_total)}</div>
    </div>
    ${trainingHistoryHtml(trainings)}
    <div style="margin-top:20px;padding:14px 16px;border-radius:14px;background:#F4EEF8;border:1px solid #E9DDEE;text-align:center;color:#69645a;font-size:13px;line-height:1.6;">
      Ačiū, kad jodinėjate su Equus. Iki susitikimo žirgyne!
    </div>`;
  return emailShell("Abonementas patvirtintas", "Abonemento informacija", inner);
}

function subscriptionExpiringHtml(clientName: string, payload: any) {
  const remaining = Math.max(0, Number(payload?.remaining ?? 1));
  const expiresAt = payload?.expires_at ? formatDate(payload.expires_at) : null;
  const inner = `
    <p style="margin:0 0 16px;">Sveiki, ${esc(clientName)}!</p>
    <p>Norime trumpai priminti, kad Jūsų abonemente liko
      <strong>${remaining} ${remaining === 1 ? "treniruotė" : "treniruotės"}</strong>.
    </p>
    <div style="margin:22px 0;padding:21px 23px;border-radius:14px;background:#F4EEF8;border:1px solid #E9DDEE;">
      <div style="font-size:12px;font-weight:700;letter-spacing:1px;color:#795E8B;">LIKUSIOS TRENIRUOTĖS</div>
      <div style="font-size:34px;font-weight:700;line-height:1.2;color:#563769;margin-top:8px;">${remaining}</div>
      ${expiresAt ? `<p style="margin:12px 0 0;font-size:13px;color:#73607F;">Abonementas galioja iki ${esc(expiresAt)}.</p>` : ""}
    </div>
    <p style="margin:18px 0 0;">Jei norėsite tęsti treniruotes, naują abonementą galėsite užsisakyti savo Equus paskyroje.</p>
    <p style="margin:16px 0 0;color:#735F7E;">Iki pasimatymo žirgyne!<br>Equus jojimo mokykla</p>`;
  return emailShell("Trumpas priminimas apie abonementą", "Kiek treniruočių dar liko", inner);
}

function globalAnnouncementHtml(clientName: string, payload: any) {
  const titleLt = String(payload?.title_lt || "Svarbus Equus atnaujinimas");
  const titleEn = String(payload?.title_en || "Important Equus update");
  const bodyLt = String(payload?.body_lt || "");
  const bodyEn = String(payload?.body_en || "");
  const url = String(payload?.url || "/grafikas");
  const inner = `
    <p style="margin:0 0 18px;font-size:15px;line-height:1.6;">Sveiki, ${esc(clientName)}!</p>
    <div style="padding:16px 18px;border-radius:15px;background:#F4EEF8;border:1px solid #E9DDEE;">
      <h2 style="margin:0;color:#563769;font-size:20px;">${esc(titleLt)}</h2>
      <p style="margin:10px 0 0;white-space:pre-wrap;font-size:15px;line-height:1.7;">${esc(bodyLt)}</p>
    </div>
    <div style="margin-top:18px;padding-top:18px;border-top:1px solid #e4ddd2;">
      <h3 style="margin:0;color:#563769;font-size:16px;">${esc(titleEn)}</h3>
      <p style="margin:8px 0 0;white-space:pre-wrap;color:#735F7E;font-size:14px;line-height:1.7;">${esc(bodyEn)}</p>
    </div>
    <div style="margin-top:20px;text-align:center;">
      <a href="https://equusjm.pages.dev${url.startsWith("/") ? url : "/" + url}"
         style="display:inline-block;padding:12px 20px;border-radius:999px;background:#68467B;color:#fff;text-decoration:none;font-weight:700;">
        Atidaryti Equus / Open Equus
      </a>
    </div>`;
  return emailShell(titleLt, "Naujiena iš Equus", inner);
}


function subscriptionRequirementWarningHtml(clientName: string, payload: any) {
  const bookingDate = payload?.booking_date ? formatDate(payload.booking_date) : null;
  const bookingTime = payload?.booking_time ? formatTime(payload.booking_time) : null;
  const remaining = Number(payload?.remaining);
  const remainingLine = Number.isFinite(remaining) && remaining > 0
    ? `<p style="margin:12px 0 0;">Abonemente dar liko <strong>${remaining} ${remaining === 1 ? "treniruotė" : "treniruotės"}</strong>.</p>`
    : "";
  const inner = `
    <p style="margin:0 0 15px;">Sveiki, ${esc(clientName)}!</p>
    ${bookingDate
      ? `<p>Primename, kad artimiausia Jūsų treniruotė – <strong>${esc(bookingDate)}${bookingTime ? ` ${esc(bookingTime)} val.` : ""}</strong>.</p>`
      : "<p>Trumpas priminimas dėl Jūsų treniruočių.</p>"}
    ${remainingLine}
    <p style="margin:18px 0 0;">Treniruočių informaciją ir abonemento likutį bet kada galite peržiūrėti savo Equus paskyroje.</p>
    <p style="margin:16px 0 0;color:#735F7E;">Iki pasimatymo!<br>Equus jojimo mokykla</p>`;
  return emailShell("Primename apie Jūsų treniruotę", "Trumpa informacija iš Equus", inner);
}

function waitlistPromotedHtml(clientName: string, payload: any) {
  const date = payload?.slot_date ? formatDate(payload.slot_date) : "";
  const time = payload?.slot_time ? formatTime(payload.slot_time) : "";
  const inner = `
    <p style="margin:0 0 16px;">Sveiki, ${esc(clientName)}!</p>
    <p>Turime gerų žinių – atsilaisvino vieta treniruotėje, kurios laukėte, ir <strong>Jūsų registracija jau patvirtinta!</strong></p>
    <div style="margin:23px 0;padding:21px 23px;border-radius:14px;border:1px solid #E9DDEE;background:#F4EEF8;">
      <p style="margin:0;font-size:12px;letter-spacing:1px;font-weight:700;color:#795E8B;">JŪSŲ TRENIRUOTĖ</p>
      <p style="margin:8px 0 0;font-size:23px;font-weight:700;color:#563769;">${esc(date)}${time ? ` · ${esc(time)} val.` : ""}</p>
      <p style="margin:8px 0 0;font-size:14px;color:#6B5579;">Vieta patvirtinta – iš naujo registruotis nereikia.</p>
    </div>
    <p>Visą informaciją rasite <a href="https://equusjm.pages.dev/grafikas" style="color:#70498A;font-weight:700;">Equus grafike</a>. Jei negalėsite dalyvauti, prašome laiku atšaukti savo rezervaciją.</p>
    <p style="margin:17px 0 0;color:#735F7E;">Labai laukiame Jūsų!<br>Equus jojimo mokykla</p>`;
  return emailShell("Jums atsilaisvino vieta!", "Registracija iš laukiančiųjų sąrašo patvirtinta", inner);
}

function giftVoucherPaymentHtml(payload: any) {
  const buyer=esc(payload?.buyer_name || "");
  const price=payload?.price_eur===null||payload?.price_eur===undefined?"kaina derinama":formatEur(payload.price_eur);
  const instructions=esc(payload?.payment_instructions || "").replace(/\n/g,"<br>");
  return emailShell("Dovanų kupono apmokėjimas","Equus jojimo mokykla",
    '<p>Sveiki, '+buyer+'!</p><p>Ačiū už dovanų kupono užklausą.</p>'
    +'<p><strong>Suma:</strong> '+price+'</p>'
    +'<p><strong>Apmokėjimo informacija:</strong></p><p>'+instructions+'</p>'
    +'<p><strong>Atsakykite į šį laišką</strong> (equusjojimomokykla@gmail.com) ir pridėkite pavedimo patvirtinimą. '
    +'Apmokėjimą tikrinsime rankiniu būdu, o kuponą atsiųsime tik po patvirtinimo.</p>');
}

function giftVoucherIssuedHtml(payload: any) {
  const buyer=esc(payload?.buyer_name || "");
  const recipient=esc(payload?.recipient_name || "");
  return emailShell("Jūsų Equus dovanų kuponas","Dovanų kuponas paruoštas",
    '<p>Sveiki, '+buyer+'!</p><p>Apmokėjimas patvirtintas. '
    +'Prisegame viso dydžio dovanų kupono paveikslėlį, kurį galėsite atsisiųsti.</p>'
    +'<p><strong>Gavėjas:</strong> '+recipient+'</p>'
    +'<p>Kuponas galioja 12 mėnesių nuo išdavimo. Paslaugai būtina išankstinė registracija.</p>'
    +'<p>Iki pasimatymo Equus jojimo mokykloje!</p>');
}

function giftVoucherEmailHtml(payload: any, admin: boolean) {
  const service=esc(payload?.service_label || "Dovanų kuponas");
  const amount=payload?.price_eur == null ? "Kaina derinama" : formatEur(payload.price_eur);
  const buyer=esc(payload?.buyer_name || "");
  const recipient=esc(payload?.recipient_name || "");
  const details=admin
    ? '<p><strong>Pirkėjas:</strong> '+buyer+'</p>'
      +'<p><strong>El. paštas:</strong> '+esc(payload?.buyer_email || "")+'</p>'
      +'<p><strong>Telefonas:</strong> '+esc(payload?.buyer_phone || "")+'</p>'
      +'<p><strong>Gavėjas:</strong> '+recipient+'</p>'
      +'<p><strong>Gavėjo telefonas:</strong> '+esc(payload?.recipient_phone || "")+'</p>'
      +(payload?.notes ? '<p><strong>Pastabos:</strong> '+esc(payload.notes)+'</p>' : "")
    : '<p>Sveiki, '+buyer+'! Gavome Jūsų dovanų kupono užklausą.</p>';
  const inner=details
    +'<p><strong>Paslauga:</strong> '+service+'</p>'
    +'<p><strong>Kaina:</strong> '+amount+'</p>'
    +(admin
      ? '<p>Užklausą rasite Equus administravimo skiltyje „Dovanų kuponai“.</p>'
      : '<p>Susisieksime dėl apmokėjimo ir kupono paruošimo. Tai dar nėra apmokėtas ar išduotas kuponas.</p>'
        +'<p>Išduotas kuponas galios 12 mėnesių nuo išdavimo datos. Visoms paslaugoms reikia išankstinės registracijos.</p>');
  return emailShell(admin ? "Nauja kupono užklausa" : "Kupono užklausa gauta", "Equus dovanų kuponai", inner);
}

function passwordResetHtml(clientName: string, payload: any) {
  const recoveryCode = String(payload?.recovery_code || "");
  const resetUrl = String(payload?.reset_url || "");
  const action = recoveryCode
    ? '<div style="margin:24px 0;padding:20px 12px;border-radius:16px;background:#F4EEF8;border:1px solid #E9DDEE;text-align:center;"><div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#795E8B;">jūsų vienkartinis kodas</div><div style="font-size:34px;letter-spacing:8px;font-weight:700;color:#563769;margin-top:10px;">' + esc(recoveryCode) + '</div><p style="margin:12px 0 0;color:#786782;font-size:12px;">Įveskite šį kodą Equus slaptažodžio atkūrimo puslapyje.</p></div>'
    : '<div style="margin:24px 0;text-align:center;"><a href="' + esc(resetUrl) + '" style="display:inline-block;padding:13px 24px;border-radius:999px;background:#68467B;color:#fff;text-decoration:none;font-weight:700;">Nustatyti naują slaptažodį</a></div>';
  const inner =
    '<p style="margin:0 0 18px;font-size:15px;line-height:1.7;">Sveiki, ' +
    esc(clientName) +
    '!</p>' +
    '<p style="margin:0;font-size:15px;line-height:1.7;">Gavome prašymą pakeisti Equus paskyros slaptažodį.</p>' +
    (recoveryCode
      ? '<p style="margin:10px 0 0;color:#735F7E;font-size:14px;line-height:1.7;">Naudokite žemiau pateiktą vienkartinį kodą, kad patvirtintumėte savo el. paštą ir pasirinktumėte naują slaptažodį.</p>'
      : '<p style="margin:10px 0 0;color:#735F7E;font-size:14px;line-height:1.7;">Paspauskite žemiau esantį mygtuką ir nustatykite naują slaptažodį. Ši nuoroda skirta tik Jums ir yra vienkartinė.</p>') +
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

    // A delayed email should never announce a booking that was later cancelled.
    if (event.event_type === "waitlist_promoted" && event.booking_id) {
      const { data: booking, error: bookingError } = await supabase
        .from("bookings").select("status").eq("id", event.booking_id).maybeSingle();
      if (bookingError) throw bookingError;
      if (!booking || booking.status !== "active") {
        const { error: skipError } = await supabase.from("email_events").update({
          status: "skipped",
          last_error: "Waitlist booking no longer active at send time",
          processing_started_at: null,
        }).eq("id", eventId).eq("status", "processing");
        if (skipError) throw skipError;
        return json({ok:true,processed:true,skipped:true,reason:"WAITLIST_BOOKING_NO_LONGER_ACTIVE"});
      }
    }

    // Subscription emails are optional; security, transactional emails and
    // important admin announcements must not be blocked by this setting.
    if (["subscription_expiring", "subscription_requirement_warning"].includes(event.event_type)) {
      let preferenceUserId: string | null = event.user_id;
      if (!preferenceUserId && event.subscription_id) {
        const { data: subscription, error: subscriptionError } = await supabase
          .from("subscriptions").select("user_id").eq("id", event.subscription_id).maybeSingle();
        if (subscriptionError) throw subscriptionError;
        preferenceUserId = subscription?.user_id ?? null;
      }
      if (preferenceUserId) {
      const { data: prefs, error: prefsError } = await supabase
        .from("profiles")
        .select("receive_subscription_emails")
        .eq("id", preferenceUserId)
        .maybeSingle();
      if (prefsError) throw prefsError;
      if (prefs?.receive_subscription_emails === false) {
        const { error: skipError } = await supabase
          .from("email_events")
          .update({
            status: "skipped",
            last_error: "Optional subscription emails disabled by rider.",
            processing_started_at: null,
          })
          .eq("id", eventId)
          .eq("status", "processing");
        if (skipError) throw skipError;
        return json({ ok: true, processed: true, skipped: true, reason: "USER_EMAIL_OPT_OUT" });
      }
      }
    }

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

      if (!["subscription_purchase", "subscription_expiring", "global_important_update", "password_reset", "gift_voucher_received", "gift_voucher_admin", "gift_voucher_payment", "gift_voucher_issued", "subscription_requirement_warning", "waitlist_promoted", "welcome_new_rider"].includes(event.event_type)) {
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
        subject = "Equus: kiek treniruočių liko Jūsų abonemente";
        html = subscriptionExpiringHtml(clientName, event.payload || {});
      }

      if (event.event_type === "subscription_requirement_warning") {
        subject = "Equus: priminimas apie Jūsų treniruotę";
        html = subscriptionRequirementWarningHtml(clientName, event.payload || {});
      }

      if (event.event_type === "waitlist_promoted") {
        subject = "Equus: Jūsų vieta treniruotėje patvirtinta!";
        html = waitlistPromotedHtml(clientName, event.payload || {});
      }

      if (event.event_type === "password_reset") {
        subject = "Equus slaptažodžio atkūrimas";
        html = passwordResetHtml(clientName, event.payload || {});
      }
      if (event.event_type === "gift_voucher_received") {
        subject = "Equus: gavome dovanų kupono užklausą";
        html = giftVoucherEmailHtml(event.payload || {}, false);
      }
      if (event.event_type === "gift_voucher_payment") {
        subject = "Equus: dovanų kupono apmokėjimo informacija";
        html = giftVoucherPaymentHtml(event.payload || {});
      }
      if (event.event_type === "gift_voucher_issued") {
        subject = "Equus: Jūsų dovanų kuponas";
        html = giftVoucherIssuedHtml(event.payload || {});
      }
      if (event.event_type === "gift_voucher_admin") {
        subject = "Equus: nauja dovanų kupono užklausa";
        html = giftVoucherEmailHtml(event.payload || {}, true);
      }

      if (event.event_type === "welcome_new_rider") {
        subject = "Sveiki prisijungę prie Equus! 🐴 Susipažinkime!";
        html = welcomeEmailHtml(clientName);
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
        ["global_important_update", "gift_voucher_issued"].includes(event.event_type)
          ? String(event.payload?.image_url || "") || null : null,
        event.event_type === "gift_voucher_issued" ? String(event.payload?.image_filename || "") : null,
        event.event_type === "gift_voucher_payment" ? "equusjojimomokykla@gmail.com" : null,
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

      if (event.event_type === "gift_voucher_issued" && event.payload?.request_id) {
        const { error: issueError } = await supabase.from("gift_voucher_requests").update({
          status: "completed", issued_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq("id", String(event.payload.request_id))
          .not("payment_confirmed_at", "is", null);
        if (issueError) console.error("Voucher was emailed but issue status sync failed:", issueError.code);
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
