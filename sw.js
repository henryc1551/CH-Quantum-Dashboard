const CACHE = "qdp-cache-v1";
const PRECACHE = ["/","/index.html","/manifest.webmanifest","/logo-192.png","/logo-512.png","/logo-maskable.png"];

self.addEventListener("install",(e)=>{ e.waitUntil(caches.open(CACHE).then(c=>c.addAll(PRECACHE))); });
self.addEventListener("fetch",(e)=>{ e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request))); });
self.addEventListener("activate",(e)=>{ e.waitUntil(caches.keys().then(keys=>Promise.all(keys.map(k=>k!==CACHE&&caches.delete(k))))); });
