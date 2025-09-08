// Quantum Dashboard Pro — Service Worker (PRO)
//
// Co robi:
// - Precache kluczowych plików (wersjonowane)
// - Stale-While-Revalidate dla GET (HTML/CSS/JS/IMG/JSON/SVG/WEBMANIFEST)
// - Offline fallback dla nawigacji (SPA → /index.html)
// - Czyszczenie starych cache’y
// - Force update: postMessage({type:'SKIP_WAITING'}) z UI
//
// Jak podbić wersję: zmień CACHE_VERSION i zdeployuj.

const CACHE_VERSION = "qdp-v4";
const PRECACHE_URLS = [
  "/",                // index fallback
  "/index.html",
  "/manifest.webmanifest",
  "/sw.js",           // tak, sw też (do szybszej dystrybucji)
  "/logo-192.png",
  "/logo-512.png",
  "/logo-maskable.png",
  "/rt/PathTracerWebGPU.js" // jeśli masz RT stub
];

// Heurystyka typów, żeby lepiej decydować strategię
function isNavigationRequest(req) {
  return req.mode === "navigate" ||
         (req.method === "GET" &&
          req.headers.get("accept")?.includes("text/html"));
}
function isCacheableGet(req) {
  if (req.method !== "GET") return false;
  const url = new URL(req.url);
  const ext = (url.pathname.split(".").pop() || "").toLowerCase();
  // Dopuszczamy: html/js/css/json/svg/png/webmanifest/jpg/webp/wasm
  return ["", "html","js","css","json","svg","png","jpg","jpeg","webp","webmanifest","wasm"].includes(ext);
}

// Usuwa query param ‘v’ (cache-busting przeglądarki), żeby klucz w cache był spójny
function normalizeRequestForCache(req) {
  const url = new URL(req.url);
  url.searchParams.delete("v");
  return new Request(url.toString(), {
    method: req.method,
    headers: req.headers,
    mode: req.mode,
    credentials: req.credentials,
    redirect: req.redirect,
    referrer: req.referrer,
    referrerPolicy: req.referrerPolicy,
    integrity: req.integrity,
    cache: "no-store"
  });
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    await cache.addAll(PRECACHE_URLS);
  })());
  // natychmiastowa aktywacja (po SKIP_WAITING)
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => {
      if (k !== CACHE_VERSION) return caches.delete(k);
    }));
    await self.clients.claim();
  })());
});

// Komunikaty z UI (np. force update)
self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data && data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

// Stale-While-Revalidate dla GET + offline fallback dla nawigacji
self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Tylko GET/HTML/etc. — inne metody puszczamy bez SW
  if (request.method !== "GET") {
    return; // network passthrough
  }

  const reqForCache = normalizeRequestForCache(request);

  // 1) Nawigacja (SPA): próbuj sieć → fallback do /index.html z cache’u
  if (isNavigationRequest(request)) {
    event.respondWith((async () => {
      try {
        const net = await fetch(request);
        // Nie keszujemy HTML na siłę (serwery często mają własne reguły)
        return net.ok ? net : await caches.match("/index.html");
      } catch {
        return await caches.match("/index.html");
      }
    })());
    return;
  }

  // 2) Zasoby statyczne/GET: Stale-While-Revalidate
  if (isCacheableGet(request)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_VERSION);
      const cached = await cache.match(reqForCache);
      const fetchPromise = (async () => {
        try {
          const net = await fetch(request);
          // Nie zapisujemy błędów 4xx/5xx do cache
          if (net && net.ok) {
            // Klonujemy odpowiedź i zapisujemy pod kluczem bez ?v=
            await cache.put(reqForCache, net.clone());
          }
          return net;
        } catch {
          return null;
        }
      })();

      // Zwróć natychmiast cache jeśli jest, równolegle odśwież
      if (cached) {
        fetchPromise.catch(()=>{});
        return cached;
      }

      // Brak w cache → sieć → w razie problemu spróbuj fallback (tylko dla HTML/IMG)
      const net = await fetchPromise;
      if (net) return net;

      // Fallbacki „ostatniej szansy”
      const url = new URL(request.url);
      const ext = (url.pathname.split(".").pop() || "").toLowerCase();
      if (ext === "png" || ext === "jpg" || ext === "jpeg" || ext === "webp" || url.pathname.includes("logo")) {
        // spróbuj choćby logo-512 jako „blank”
        return await caches.match("/logo-512.png") || new Response("", {status: 504});
      }
      return new Response("", { status: 504 });
    })());
    return;
  }

  // Inne żądania → do sieci (np. POST do API)
  // (Tu świadomie nie keszujemy odpowiedzi API)
});
