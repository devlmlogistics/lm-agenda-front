self.addEventListener("push", (event) => {
  const data = event.data ? event.data.json() : {};
  event.waitUntil(self.registration.showNotification(data.title || "LM Logistics", {
    body: data.body || "A new update is available.",
    icon: "/favicon.svg",
    badge: "/favicon.svg",
    data: { url: data.url || "/#/agenda" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data.url));
});

