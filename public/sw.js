const CACHE_NAME = "easybrainrot-shell-v1";
const SHELL = ["/", "/manifest.webmanifest", "/easybrainrot/logo.png"];
self.addEventListener("install", (event) => { event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener("activate", (event) => { event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))); self.clients.claim(); });
self.addEventListener("fetch", (event) => { if (event.request.method !== "GET" || new URL(event.request.url).pathname.startsWith("/api/")) return; event.respondWith(fetch(event.request).catch(() => caches.match(event.request).then((cached) => cached || caches.match("/")))); });
