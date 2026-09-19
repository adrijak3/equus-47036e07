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

export async function getPushSubscription() {
  if (!pushNotificationsSupported()) return null;
  const registration = await navigator.serviceWorker.register("/sw.js");
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

  if (!VAPID_PUBLIC_KEY) {
    throw new Error(
      language === "lt"
        ? "Trūksta VITE_VAPID_PUBLIC_KEY nustatymo."
        : "VITE_VAPID_PUBLIC_KEY is not configured.",
    );
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error(
      language === "lt"
        ? "Pranešimų leidimas nebuvo suteiktas."
        : "Notification permission was not granted.",
    );
  }

  const registration = await navigator.serviceWorker.register("/sw.js");
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: base64ToUint8Array(VAPID_PUBLIC_KEY),
  });

  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) {
    throw new Error("Invalid push subscription");
  }

  const { error } = await supabase.from("push_subscriptions" as any).upsert(
    {
      user_id: (await supabase.auth.getUser()).data.user?.id,
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
      language,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "endpoint" },
  );

  if (error) throw error;
  return subscription;
}

export async function disablePushNotifications() {
  if (!pushNotificationsSupported()) return;

  const subscription = await getPushSubscription();
  if (!subscription) return;

  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();
  await supabase
    .from("push_subscriptions" as any)
    .delete()
    .eq("endpoint", endpoint);
}

export async function syncPushLanguage(language: EquusLanguage) {
  if (!pushNotificationsSupported()) return;
  const subscription = await getPushSubscription();
  if (!subscription) return;

  await supabase
    .from("push_subscriptions" as any)
    .update({ language, updated_at: new Date().toISOString() })
    .eq("endpoint", subscription.endpoint);
}

export async function flushPushNotifications() {
  try {
    await supabase.functions.invoke("push-notifications");
  } catch {
    // Non-fatal: queued notifications can be delivered by the scheduler.
  }
}
