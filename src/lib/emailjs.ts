import emailjs from "@emailjs/browser";

const SERVICE_ID = import.meta.env.VITE_EMAILJS_SERVICE_ID as string | undefined;
const TEMPLATE_ID = import.meta.env.VITE_EMAILJS_TEMPLATE_ID as string | undefined;
const PUBLIC_KEY = import.meta.env.VITE_EMAILJS_PUBLIC_KEY as string | undefined;

export const isEmailJsConfigured = Boolean(SERVICE_ID && TEMPLATE_ID && PUBLIC_KEY);

if (isEmailJsConfigured) {
  emailjs.init({ publicKey: PUBLIC_KEY! });
}

export type EmailParams = Record<string, unknown>;

function assertConfigured(templateId?: string) {
  if (!SERVICE_ID || !templateId || !PUBLIC_KEY) {
    throw new Error(
      "EmailJS nesukonfigūruotas: trūksta VITE_EMAILJS_SERVICE_ID / VITE_EMAILJS_TEMPLATE_ID / VITE_EMAILJS_PUBLIC_KEY.",
    );
  }
}

/** Sends an email through EmailJS. Throws if not configured or if the send fails. */
export async function sendEmail(params: EmailParams, templateId = TEMPLATE_ID) {
  assertConfigured(templateId);
  return emailjs.send(SERVICE_ID!, templateId!, params as Record<string, string>, {
    publicKey: PUBLIC_KEY!,
  });
}

/** Sends an email using a native <form> element (EmailJS field-name mapping). */
export async function sendEmailForm(form: HTMLFormElement, templateId = TEMPLATE_ID) {
  assertConfigured(templateId);
  return emailjs.sendForm(SERVICE_ID!, templateId!, form, { publicKey: PUBLIC_KEY! });
}

export default emailjs;