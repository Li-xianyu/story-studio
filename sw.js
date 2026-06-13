const SW_VERSION = "20260613y";
const CACHE_NAME = "xy-story-shell-" + SW_VERSION;

function cacheable(request, response) {
  if (request.method !== "GET") return false;
  if (!response || response.status !== 200 || response.type === "opaque") return false;
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("text/event-stream")) return false;
  if (contentType.includes("application/json")) return false;
  return true;
}

async function tryCache(request, response) {
  if (!cacheable(request, response)) return;
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
  } catch (_) {}
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    await tryCache(request, response);
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw error;
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  await tryCache(request, response);
  return response;
}

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key.startsWith("xy-story-shell-") && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request));
    return;
  }

  if (url.origin === self.location.origin) {
    if (request.destination === "script" || request.destination === "style" ||
        request.destination === "manifest") {
      event.respondWith(networkFirst(request));
      return;
    }
    event.respondWith(cacheFirst(request));
  }
});
