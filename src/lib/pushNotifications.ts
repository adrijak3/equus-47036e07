import { supabase } from "@/integrations/supabase/client";
import type { EquusLanguage } from "@/contexts/LanguageContext";

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

function base64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized);
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)));
}

export function pushNotificationsSupported() {
  return (
    typeof window !== "undefined" &&
    "Notification" in window &&
    "serviceWorker" in navigator &&
    "PushManager" in window
  );
}

async function getReadyRegistration() {
  if (!pushNotificationsSupported()) return null;
  const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  return await navigator.serviceWorker.ready || registration;
}

export async function getPushSubscription() {
  const registration = await getReadyRegistration();
  if (!registration) return null;
  return registration.pushManager.getSubscription();
}

export async function enablePushNotifications(language: EquusLanguage) {
  if (!pushNotificationsSupported()) {
    throw new Error(
      language === "lt"
        ? "Ši naršyklė nepalaiko telefono pranešimų."
        : "This browser does not support phone notifications.",
    );
  }

  const permission = Notification.permission === "granted"
    ? "granted"
    : await Notification.requestPermission();

  if (permission !== "granted") {
    throw new Error(
      language === "lt"
        ? "Telefono pranešimų leidimas nebuvo suteiktas. Naršyklės nustatymuose leiskite pranešimus Equus svetainei ir bandykite dar kartą."
        : "Phone notification permission was not granted. Allow notifications for Equus in your browser settings and try again.",
    );
  }

  const registration = await getReadyRegistration();
  if (!registration) {
    throw new Error(
      language === "lt"
        ? "Nepavyko paruošti Equus pranešimų tarnybos."
        : "Could not prepare the Equus notification service.",
    );
  }

  if (!VAPID_PUBLIC_KEY) {
    throw new Error(
      language === "lt"
        ? "Trūksta VITE_VAPID_PUBLIC_KEY nustatymo."
        : "VITE_VAPID_PUBLIC_KEY is not configured.",
    );
  }

  let subscription = await registration.pushManager.getSubscription();

  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }

  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) {
    throw new Error(
      language === "lt"
        ? "Naršyklė pateikė netinkamą telefono pranešimų prenumeratą."
        : "The browser returned an invalid phone notification subscription.",
    );
  }

  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) {
    throw new Error(
      language === "lt" ? "Reikia būti prisijungus." : "You must be signed in.",
    );
  }

  const { error } = await (supabase.from("push_subscriptions" as any) as any).upsert(
    {
      user_id: userId,
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
      language,
      active: true,
      invalid_at: null,
      last_error: null,
      last_seen_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "endpoint" },
  );

  if (error) {
    throw new Error(
      language === "lt"
        ? `Nepavyko išsaugoti telefono pranešimų prenumeratos: ${error.message}`
        : `Could not save the phone notification subscription: ${error.message}`,
    );
  }

  // Re-read the row. The UI only reports success after Supabase confirms it exists.
  const { data: saved, error: verifyError } = await (supabase.from("push_subscriptions" as any) as any)
    .select("id,active")
    .eq("user_id", userId)
    .eq("endpoint", json.endpoint)
    .maybeSingle();

  if (verifyError || !saved?.id || saved.active !== true) {
    throw new Error(
      language === "lt"
        ? "Telefono pranešimų prenumerata nebuvo patvirtinta serveryje."
        : "The phone notification subscription was not confirmed by the server.",
    );
  }

  return subscription;
}

export async function disablePushNotifications() {
  if (!pushNotificationsSupported()) return;

  const subscription = await getPushSubscription();
  if (!subscription) return;

  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();

  const { error } = await (supabase.from("push_subscriptions" as any) as any)
    .update({
      active: false,
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("endpoint", endpoint);

  if (error) throw error;
}

export async function syncPushLanguage(language: EquusLanguage) {
  if (!pushNotificationsSupported()) return;
  const subscription = await getPushSubscription();
  if (!subscription) return;

  await (supabase.from("push_subscriptions" as any) as any)
    .update({
      language,
      active: true,
      updated_at: new Date().toISOString(),
    })
    .eq("endpoint", subscription.endpoint);
}

export async function flushPushNotifications() {
  try {
    await supabase.functions.invoke("push-notifications");
  } catch {
    // Non-fatal: the server-side cron worker is authoritative.
  }
}
