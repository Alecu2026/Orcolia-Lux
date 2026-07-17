/* Service Worker — caching + push notifications + badge */

// Cache version tied to deploy — update this string to bust old caches
const CACHE_VER = "v5";
const CACHE = `app-${CACHE_VER}`;
const OFFLINE_URL = "/offline.html";

const PRECACHE = [
  OFFLINE_URL,
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-192.png",
  "/icons/icon-maskable-512.png",
];

// ── Install ──────────────────────────────────────────────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

// ── Activate: delete stale caches, enable navigation preload ────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      // Delete old cache versions
      caches.keys().then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      ),
      // Enable navigation preload if supported (speeds up page navigation)
      self.registration.navigationPreload?.enable(),
    ]).then(() => self.clients.claim()),
  );
});

// ── Fetch ────────────────────────────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (url.origin !== self.location.origin) return;

  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/_next/webpack-hmr") ||
    url.pathname.includes("__nextjs")
  ) return;

  // Static assets (_next/static) — cache-first (content-hashed, never change)
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(request).then((cached) =>
        cached ?? fetch(request).then((res) => {
          if (res.ok) caches.open(CACHE).then((c) => c.put(request, res.clone()));
          return res;
        }),
      ),
    );
    return;
  }

  // Icons & static images — cache-first
  if (
    url.pathname.startsWith("/icons/") ||
    url.pathname.match(/\.(png|svg|ico|webp|jpg|jpeg|gif|woff2|woff)$/)
  ) {
    event.respondWith(
      caches.match(request).then((cached) =>
        cached ?? fetch(request).then((res) => {
          if (res.ok) caches.open(CACHE).then((c) => c.put(request, res.clone()));
          return res;
        }),
      ),
    );
    return;
  }

  // Navigation — use preloaded response if available, then network, fallback offline
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          // navigation preload response (already in-flight while SW started)
          const preloaded = await event.preloadResponse;
          if (preloaded) return preloaded;
          return await fetch(request);
        } catch {
          return (await caches.match(OFFLINE_URL)) ?? new Response("Offline", { status: 503 });
        }
      })(),
    );
    return;
  }
});

// ── Push notifications + Badging API ─────────────────────────────────────────
self.addEventListener("push", (event) => {
  let payload = { title: "CRM Proiecte", body: "", url: "/dashboard", badge: 0 };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch {
    if (event.data) payload.body = event.data.text();
  }

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(payload.title, {
        body: payload.body,
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-maskable-192.png",
        data: { url: payload.url },
        vibrate: [80, 40, 80],
        tag: "crm-notification",     // replace previous instead of stacking
        renotify: true,
      }),
      // Update app icon badge count if API available
      payload.badge > 0 && "setAppBadge" in self
        ? self.setAppBadge(payload.badge)
        : Promise.resolve(),
    ]),
  );
});

// ── Notification click ────────────────────────────────────────────────────────
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  // Clear badge when user interacts
  if ("clearAppBadge" in self) self.clearAppBadge().catch(() => {});

  const urlPath = (event.notification.data && event.notification.data.url) || "/dashboard";
  const scope = self.registration.scope;
  const origin = new URL(scope).origin;
  const targetUrl = urlPath.startsWith("http") ? urlPath : origin + urlPath;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url === targetUrl) return client.focus();
      }
      for (const client of list) {
        if (client.url.startsWith(scope)) {
          if ("navigate" in client) {
            return client.navigate(targetUrl)
              .then((c) => c ? c.focus() : self.clients.openWindow(targetUrl))
              .catch(() => self.clients.openWindow(targetUrl));
          }
          return self.clients.openWindow(targetUrl);
        }
      }
      return self.clients.openWindow(targetUrl);
    }),
  );
});

// ── Messages from page ────────────────────────────────────────────────────────
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") {
    self.skipWaiting();
  }
  // Page tells SW the current unread count to sync badge
  if (event.data?.type === "SET_BADGE" && "setAppBadge" in self) {
    const count = event.data.count;
    (count > 0 ? self.setAppBadge(count) : self.clearAppBadge()).catch(() => {});
  }
});
