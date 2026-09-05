// Reader service worker.
//
// Network-first for everything so an installed copy never serves a stale
// interface while online. The cache only backs same-origin GET requests and is
// used as an offline fallback for the app shell and previously loaded assets.

const CACHE_NAME = "reader-shell-v2";
const SHELL_URLS = ["/", "/index.html", "/styles.css", "/app.js", "/icons.js", "/favicon.svg", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => Promise.allSettled(SHELL_URLS.map((url) => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

const isCacheableRequest = (request) => {
  if (request.method !== "GET") {
    return false;
  }

  const url = new URL(request.url);
  return url.origin === self.location.origin && !url.pathname.startsWith("/api/");
};

const networkFirst = async (request) => {
  const cache = await caches.open(CACHE_NAME);

  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request, { ignoreSearch: request.mode === "navigate" });
    if (cached) {
      return cached;
    }

    if (request.mode === "navigate") {
      const shell = await cache.match("/index.html");
      if (shell) {
        return shell;
      }
    }

    throw error;
  }
};

self.addEventListener("fetch", (event) => {
  if (!isCacheableRequest(event.request)) {
    return;
  }

  event.respondWith(networkFirst(event.request));
});
