// Equus single service worker: push + offline shell + reliable deployment updates.
// Version changes intentionally retire outdated caches from older builds.
const CACHE_VERSION = "equus-v20261117-1";
const PAGE_CACHE = CACHE_VERSION + "-pages";
const ASSET_CACHE = CACHE_VERSION + "-assets";
const OFFLINE_PAGE = "/";
self.addEventListener("install", event => {
  self.skipWaiting();
  event.waitUntil(caches.open(PAGE_CACHE).then(cache => cache.add(new Request(OFFLINE_PAGE, { cache: "reload" })).catch(() => undefined)));
});
self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key !== PAGE_CACHE && key !== ASSET_CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Never cache API traffic, service worker, manifest or unversioned icons.
  if (url.pathname.startsWith("/api/") || ["/sw.js", "/manifest.webmanifest"].includes(url.pathname) || /\.(png|ico|svg)$/.test(url.pathname)) return;
  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const response = await fetch(new Request(request, { cache: "no-store" }));
        if (response.ok) { const cache = await caches.open(PAGE_CACHE); await cache.put(OFFLINE_PAGE, response.clone()); }
        return response;
      } catch {
        return await caches.match(OFFLINE_PAGE) || Response.error();
      }
    })());
  } else if (/^\/assets\/.*\.[a-zA-Z0-9_-]{8,}\.(js|css)$/.test(url.pathname) || /\.(woff2?)$/.test(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(ASSET_CACHE);
      const saved = await cache.match(request);
      if (saved) return saved;
      const response = await fetch(request);
      if (response.ok) await cache.put(request, response.clone());
      return response;
    })());
  }
});
self.addEventListener("push", event => {
  if (!event.data) return;
  event.waitUntil((async () => {
    try {
      const data = event.data.json();
      const targetUrl = data.url || "/grafikas";
      const url = new URL(targetUrl, self.location.origin);
      const safeUrl = url.origin === self.location.origin ? url.href : new URL("/grafikas", self.location.origin).href;
      await self.registration.showNotification(data.title || "Equus", {
        body: data.body || "",
        icon: "/equus-icon-192.png?v=20261117",
        // Android badge should be a transparent silhouette instead of a square full-colour icon.
        badge: "/equus-badge-96.png?v=20261117",
        vibrate: [100, 50, 100],
        tag: data.kind || "equus-notification",
        renotify: true,
        data: { url: safeUrl }
      });
    } catch (error) { console.error("Equus push event error:", error); }
  })());
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/grafikas", self.location.origin);
  const target = url.origin === self.location.origin ? url.href : new URL("/grafikas", self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async windows => {
    for (const client of windows) {
      if (client.url === target && "focus" in client) return client.focus();
    }
    for (const client of windows) {
      if ("navigate" in client && "focus" in client) {
        const navigated = await client.navigate(target);
        if (navigated) return navigated.focus();
      }
    }
    return self.clients.openWindow ? self.clients.openWindow(target) : undefined;
  }));
});
