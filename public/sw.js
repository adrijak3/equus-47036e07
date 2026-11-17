self.addEventListener("push", (event) => {
  if (!event.data) return;

  try {
    const data = event.data.json();
    const targetUrl = data.url || "/grafikas";

    const options = {
      body: data.body || "",
      icon: "/equus-icon-192.png",
      badge: "/equus-icon-192.png",
      vibrate: [100, 50, 100],
      tag: data.kind || "equus-notification",
      renotify: true,
      data: {
        url: targetUrl,
      },
    };

    event.waitUntil(
      self.registration.showNotification(data.title || "🐴 Equus", options),
    );
  } catch (error) {
    console.error("Equus push event error:", error);
  }
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const rawUrl = event.notification.data?.url || "/grafikas";
  const targetUrl = new URL(rawUrl, self.location.origin).href;

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url === targetUrl && "focus" in client) {
          return client.focus();
        }
      }

      for (const client of windowClients) {
        if ("navigate" in client && "focus" in client) {
          return client.navigate(targetUrl).then(() => client.focus());
        }
      }

      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }

      return undefined;
    }),
  );
});
