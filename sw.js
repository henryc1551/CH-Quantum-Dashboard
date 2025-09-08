// LeonCloudQ PWA SW v6.6.0
const CACHE = "leonq-cache-v660";
const PRECACHE = [
  "/", "/index.html",
  "/manifest.webmanifest",
  "/logo-192.png","/logo-512.png","/logo-maskable.png",
  "/favicon.ico",
  "/notify.mp3","/success.mp3","/error.mp3"
];

self.addEventListener("install",(e)=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(PRECACHE)));
  self.skipWaiting();
});
self.addEventListener("activate",(e)=>{
  e.waitUntil(caches.keys().then(keys=>Promise.all(keys.map(k=>k!==CACHE&&caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener("fetch",(e)=>{
  if(e.request.mode==="navigate"){
    e.respondWith(caches.match("/index.html").then(r=>r||fetch(e.request)));
    return;
  }
  e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)));
});
