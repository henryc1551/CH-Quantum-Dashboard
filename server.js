// server.js — drop-in dla Deno Deploy (ESM, bez Node/Express)

// ---- USTAWIENIA LEKKIE ----
const V = "1.0.0";
const CORS_ORIGINS = ["*"]; // podmień na swoją domenę gdy wdrożysz
const DEFAULT_HTML = "./index.html";

// mapowanie MIME
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8",
};

// proste nagłówki bezpieczeństwa + CORS
function sec(u) {
  const allow =
    CORS_ORIGINS.includes("*") || CORS_ORIGINS.includes(u.origin)
      ? CORS_ORIGINS.includes("*") ? "*" : u.origin
      : "null";
  return {
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    "content-security-policy": "default-src 'self' 'unsafe-inline'; connect-src 'self' https:; img-src 'self' data: https:; media-src 'self' https:; frame-ancestors 'self';",
    "access-control-allow-origin": allow,
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,authorization",
  };
}

// mały helper do odpowiedzi JSON
function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

// wczytanie assetu z bundla (Deno Deploy) bez fs
async function serveFile(pathname) {
  // normalizacja ścieżki
  const path = pathname.replace(/^\/+/, "./");
  const url = new URL(path, import.meta.url);
  const ext = (path.match(/\.[^.]+$/)?.[0] || "").toLowerCase();
  const mime = MIME[ext] || "application/octet-stream";
  const resp = await fetch(url).catch(() => null);
  if (!resp || !resp.ok) return null;
  // przepuszczamy body bezpośrednio (stream)
  const headers = new Headers(resp.headers);
  headers.set("content-type", mime);
  return new Response(resp.body, { status: 200, headers });
}

// router API (lekkie demo – możesz rozszerzać w repo)
async function handleApi(u, req) {
  // /api/hello?name=World
  if (u.pathname === "/api/hello" && req.method === "GET") {
    const name = u.searchParams.get("name") || "World";
    return json({ ok: true, msg: `Hello, ${name}!` });
  }

  // /api/echo (POST {anything})
  if (u.pathname === "/api/echo" && req.method === "POST") {
    let body = {};
    try {
      body = await req.json();
    } catch {
      // ignoruj
    }
    return json({ ok: true, youSent: body });
  }

  // /api/version
  if (u.pathname === "/api/version" && req.method === "GET") {
    return json({ ok: true, version: V });
  }

  return null; // nieobsłużone → pozostała część serwera
}

// ------------- GŁÓWNY SERWER -------------
Deno.serve(async (req) => {
  const u = new URL(req.url);

  // szybk(a) obsługa CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: sec(u) });
  }

  // HEALTH / STATUS
  if (u.pathname === "/healthz") return json({ ok: true, ts: Date.now() }, 200, sec(u));
  if (u.pathname === "/version") return json({ ok: true, version: V }, 200, sec(u));

  // API
  if (u.pathname.startsWith("/api/")) {
    const r = await handleApi(u, req);
    if (r) {
      // dołóż nagłówki bezpieczeństwa
      const h = new Headers(r.headers);
      Object.entries(sec(u)).forEach(([k, v]) => h.set(k, v));
      return new Response(r.body, { status: r.status, headers: h });
    }
    return json({ ok: false, error: "Unknown API route" }, 404, sec(u));
  }

  // serwowanie plików statycznych (index.html, sw.js, manifest, style.css, itp.)
  // 1) próba exact hit
  let staticResp = await serveFile(u.pathname.slice(1));
  if (staticResp) {
    const h = new Headers(staticResp.headers);
    Object.entries(sec(u)).forEach(([k, v]) => h.set(k, v));
    return new Response(staticResp.body, { status: 200, headers: h });
  }

  // 2) fallback na index.html (Single Page App / dashboard)
  staticResp = await serveFile(DEFAULT_HTML);
  if (staticResp) {
    const h = new Headers(staticResp.headers);
    Object.entries(sec(u)).forEach(([k, v]) => h.set(k, v));
    return new Response(staticResp.body, { status: 200, headers: h });
  }

  // 404 gdy nie mamy nawet index.html
  return new Response("Not Found", { status: 404, headers: sec(u) });
});
