self.addEventListener("push", (event) => {
  let payload = {
    title: "Chrona",
    body: "You have a new notification.",
    url: "/",
  };

  try {
    if (event.data) {
      payload = {
        ...payload,
        ...event.data.json(),
      };
    }
  } catch (error) {
    console.error(
      "Could not parse Chrona push payload:",
      error,
    );
  }

  const options = {
    body: payload.body,
    icon: "/favicon.ico",
    badge: "/favicon.ico",

    tag:
      payload.tag ||
      `chrona-${Date.now()}`,

    data: {
      url:
        payload.url ||
        "/",
    },
  };

  event.waitUntil(
    self.registration.showNotification(
      payload.title || "Chrona",
      options,
    ),
  );
});

self.addEventListener(
  "notificationclick",
  (event) => {
    event.notification.close();

    const targetUrl =
      event.notification.data?.url ||
      "/";

    event.waitUntil(
      (async () => {
        const windowClients =
          await self.clients.matchAll({
            type: "window",
            includeUncontrolled: true,
          });

        for (const client of windowClients) {
          try {
            const clientUrl =
              new URL(client.url);

            if (
              clientUrl.origin ===
              self.location.origin
            ) {
              if (
                "navigate" in client
              ) {
                await client.navigate(
                  targetUrl,
                );
              }

              await client.focus();
              return;
            }
          } catch {
            // Ignore malformed client URL.
          }
        }

        await self.clients.openWindow(
          targetUrl,
        );
      })(),
    );
  },
);