/** A single, explicitly maintained worker handles both push and app updates. */
const SW_URL = "/sw.js";
function isRefusedContext(): boolean {
  if (!import.meta.env.PROD || typeof window === "undefined") return true;
  try { if (window.self !== window.top) return true; } catch { return true; }
  const host = window.location.hostname;
  if (host.startsWith("id-preview--") || host.startsWith("preview--")) return true;
  return new URLSearchParams(window.location.search).get("sw") === "off";
}
async function unregisterAppWorkers() {
  if (!("serviceWorker" in navigator)) return;
  const regs = await navigator.serviceWorker.getRegistrations();
  await Promise.allSettled(regs.filter(r =>
    (r.active?.scriptURL ?? r.installing?.scriptURL ?? "").endsWith(SW_URL)
  ).map(r => r.unregister()));
}
export function registerEquusServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  if (isRefusedContext()) { void unregisterAppWorkers(); return; }
  let refreshedForUpdate = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!refreshedForUpdate) { refreshedForUpdate = true; window.location.reload(); }
  });
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register(SW_URL, { scope: "/", updateViaCache: "none" }).then(registration => {
      // A new deployment becomes available on the next open/focus, not once a week.
      const check = () => { if (navigator.onLine) void registration.update().catch(() => undefined); };
      const onVisible = () => { if (document.visibilityState === "visible") check(); };
      window.addEventListener("focus", check);
      window.addEventListener("online", check);
      document.addEventListener("visibilitychange", onVisible);
      const timer = window.setInterval(check, 60 * 60 * 1000);
      window.addEventListener("pagehide", () => {
        window.removeEventListener("focus", check);
        window.removeEventListener("online", check);
        document.removeEventListener("visibilitychange", onVisible);
        window.clearInterval(timer);
      }, { once: true });
      check();
    }).catch(() => undefined);
  }, { once: true });
}
