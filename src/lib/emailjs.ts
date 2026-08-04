import emailjs from "@emailjs/browser";

// Only public EmailJS credentials are used here (safe for the browser bundle).
const SERVICE_ID = import.meta.env.VITE_EMAILJS_SERVICE_ID as string | undefined;
const RECEIVED_TEMPLATE_ID = import.meta.env
  .VITE_EMAILJS_RECEIVED_TEMPLATE_ID as string | undefined;
const STATUS_TEMPLATE_ID = import.meta.env
  .VITE_EMAILJS_STATUS_TEMPLATE_ID as string | undefined;
const PUBLIC_KEY = import.meta.env.VITE_EMAILJS_PUBLIC_KEY as string | undefined;

export const isEmailJsConfigured = Boolean(
  SERVICE_ID && PUBLIC_KEY && (RECEIVED_TEMPLATE_ID || STATUS_TEMPLATE_ID),
);

if (SERVICE_ID && PUBLIC_KEY) {
  emailjs.init({ publicKey: PUBLIC_KEY });
}

export type ReservationEmailParams = {
  customer_email: string;
  customer_name: string;
  reservation_date?: string;
  reservation_time?: string;
  service_name?: string;
  customer_link?: string;
  status_message?: string;
};

function buildParams(params: ReservationEmailParams): Record<string, string> {
  return {
    customer_email: params.customer_email ?? "",
    customer_name: params.customer_name ?? "",
    reservation_date: params.reservation_date ?? "",
    reservation_time: params.reservation_time ?? "",
    service_name: params.service_name ?? "",
    customer_link: params.customer_link ?? "",
    status_message: params.status_message ?? "",
  };
}

async function send(templateId: string | undefined, params: ReservationEmailParams) {
  if (!SERVICE_ID || !PUBLIC_KEY || !templateId) {
    throw new Error("EmailJS nesukonfigūruotas: trūksta aplinkos kintamųjų.");
  }

  return emailjs.send(SERVICE_ID, templateId, buildParams(params), {
    publicKey: PUBLIC_KEY,
  });
}

/** Confirmation email sent right after a public registration request is saved. */
export async function sendReservationReceived(params: ReservationEmailParams) {
  return send(RECEIVED_TEMPLATE_ID, params);
}

/** Status email sent when admin approves, rejects or proposes another time. */
export async function sendReservationStatus(params: ReservationEmailParams) {
  return send(STATUS_TEMPLATE_ID, params);
}