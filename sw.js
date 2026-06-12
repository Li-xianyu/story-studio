const SW_VERSION = "20260613";
const CACHE_NAME = "xy-story-shell-" + SW_VERSION;
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./favicon.svg",
  "./favicon.ico",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./css/tokens.css",
  "./css/reset.css",
  "./css/layout.css",
  "./css/components.css",
  "./css/reader.css",
  "./css/composer.css",
  "./css/animations.css",
  "./css/responsive.css",
  "./js/app.js",
  "./js/core/state.js",
  "./js/core/api.js",
  "./js/core/tts.js",
  "./js/core/speech-track.js",
  "./js/core/utils.js",
  "./js/story/story.js",
  "./js/story/memory.js",
  "./js/story/import-export.js",
  "./js/ui/renderer.js",
  "./js/ui/events.js",
  "./js/ui/dialogs.js",
  "./js/ui/custom-select.js",
  "./vendor/lucide/0.468.0/lucide.min.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put("./index.html", copy));
          return response;
        })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (!response || response.status !== 200 || response.type === "opaque") return response;
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        return response;
      });
    })
  );
});
