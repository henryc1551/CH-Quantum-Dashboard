// CH-Quantum PWA Service Worker (v3)
const CACHE = "LCQ-v3";
const PRECACHE = [
  "/", "/index.html", "/style.css", "/manifest.webmanifest",
  "/logo-dark.svg", "/logo-light.svg",
  "/landing.html", "/landing-en.html"
  // Ikony PNG dorzuć tu, jeśli masz w repo:
  // "/icon-dark-192.png","/icon-dark-512.png","/icon-light-192.png","/icon-light-512.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(PRECACHE);
  })());
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
  })());
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const { request } = e;
  e.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    try {
      const fresh = await fetch(request);
      return fresh;
    } catch {
      // awaryjnie pokaż landing (offline)
      if (request.mode === "navigate") {
        return caches.match("/index.html");
      }
      throw;
    }
  })());
});
