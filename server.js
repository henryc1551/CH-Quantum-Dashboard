// server.js — v6.3.1
import { serveFile } from "https://deno.land/std@0.224.0/http/file_server.ts";

const VERSION = "6.3.1";
const QDP_TOKEN = Deno.env.get("QDP_TOKEN") ?? "";
const COOKIE_DAYS = parseInt(Deno.env.get("QDP_COOKIE_DAYS") ?? "30", 10);

const kv = await (async () => {
  try { return await Deno.openKv(); } catch { return null; }
})();

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json; charset=utf-8" },
    ...init,
  });
}
function notFound() { return new Response("Not Found", { status: 404 }); }

function setCookie(respHeaders, name, value, days) {
  const exp = new Date(Date.now() + days * 864e5).toUTCString();
  respHeaders.append("set-cookie", `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Expires=${exp}`);
}
function hasAuth(req) {
  const c = req.headers.get("cookie") ?? "";
  return !!QDP_TOKEN && c.includes("qdp=");
}

async function serveStatic(req) {
  const url = new URL(req.url);
  let pathname = decodeURIComponent(url.pathname);

  const staticWhitelist = new Set([
    "/", "/index.html",
    "/manifest.webmanifest", "/sw.js",
    "/logo-light.svg", "/logo-192.png", "/logo-512.png", "/logo-maskable.png",
    "/favicon.ico", "/robots.txt", "/sitemap.xml"
  ]);

  // znane pliki
  if (staticWhitelist.has(pathname)) {
    const file = pathname === "/" ? "/index.html" : pathname;
    try { return await serveFile(req, `.${file}`); } catch {}
  }

  // inne assety (np. /assets/x.css, /img/a.png)
  if (pathname.includes(".")) {
    try { return await serveFile(req, `.${pathname}`); } catch {}
  }

  // fallback SPA → index.html
  try {
    const res = await serveFile(req, "./index.html");
    const h = new Headers(res.headers);
    h.set("cache-control", "no-store");
    return new Response(res.body, { status: 200, headers: h });
  } catch {
    return notFound();
  }
}

// --- ACTIONS (lekki orchestrator pod czat/UI) ---
const Actions = {
  "projects.syncKV": async () => {
    if (!kv) return { ok: false, err: "kv-disabled" };
    return { ok: true, ts: Date.now() };
  },
  "projects.verifyHead": async ({ url }) => {
    try {
      const r = await fetch(url, { method: "HEAD" });
      return { ok: r.ok, status: r.status, headers: Object.fromEntries(r.headers) };
    } catch (e) {
      return { ok: false, err: String(e) };
    }
  },
  "deploy.webhook": async ({ url, secret }) => {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-qdp-secret": secret || "" },
        body: JSON.stringify({ ts: Date.now(), source: "qdp" }),
      });
      const body = await r.text();
      return { ok: r.ok, status: r.status, body };
    } catch (e) {
      return { ok: false, err: String(e) };
    }
  },
  "kv.put": async ({ key, value }) => {
    if (!kv) return { ok: false, err: "kv-disabled" };
    await kv.set(["qdp", key], value);
    return { ok: true };
  },
  "kv.get": async ({ key }) => {
    if (!kv) return { ok: false, err: "kv-disabled" };
    const r = await kv.get(["qdp", key]);
    return { ok: true, value: r.value ?? null };
  }
};

async function handleApi(req) {
  const { pathname, searchParams } = new URL(req.url);

  if (pathname === "/version") {
    return json({ ok: true, version: VERSION, kv: !!kv, flags: { email: false, license: true, forward: false } });
  }
  if (pathname === "/healthz") {
    if (QDP_TOKEN && !hasAuth(req)) return json({ ok: false, err: "unauthorized" }, { status: 401 });
    return json({ ok: true, ts: Date.now() });
  }

  // prosty KV API
  if (pathname.startsWith("/api/kv/") && kv) {
    if (QDP_TOKEN && !hasAuth(req)) return json({ ok: false, err: "unauthorized" }, { status: 401 });
    const key = pathname.replace("/api/kv/", "");
    if (req.method === "GET") {
      const r = await kv.get(["qdp", key]);
      return json({ ok: true, value: r.value ?? null });
    }
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      await kv.set(["qdp", key], body);
      return json({ ok: true });
    }
    if (req.method === "DELETE") {
      await kv.delete(["qdp", key]);
      return json({ ok: true });
    }
  }

  // Actions (asystent)
  if (pathname === "/api/assist/run" && req.method === "POST") {
    if (QDP_TOKEN && !hasAuth(req)) return json({ ok: false, err: "unauthorized" }, { status: 401 });
    const { action, params } = await req.json().catch(() => ({}));
    if (!action || !(action in Actions)) return json({ ok: false, err: "unknown-action" }, { status: 400 });
    const out = await Actions[action](params || {});
    return json(out);
  }

  // ustaw cookie przy ?token=
  if (searchParams.has("token")) {
    const t = searchParams.get("token") ?? "";
    if (!QDP_TOKEN) return json({ ok: false, err: "QDP_TOKEN not set in ENV" }, { status: 500 });
    const headers = new Headers({ "content-type": "text/html; charset=utf-8" });
    if (t === QDP_TOKEN) {
      setCookie(headers, "qdp", "1", COOKIE_DAYS);
      const url = new URL(req.url); url.searchParams.delete("token");
      return new Response(`<meta http-equiv="refresh" content="0;url='${url.toString()}'" />`, { headers });
    }
    return json({ ok: false, err: "invalid token" }, { status: 401 });
  }

  return null;
}

Deno.serve(async (req) => {
  try {
    const api = await handleApi(req);
    if (api) return api;

    const res = await serveStatic(req);
    const h = new Headers(res.headers);
    h.set("referrer-policy", "strict-origin-when-cross-origin");
    h.set("x-content-type-options", "nosniff");
    h.set("permissions-policy", "geolocation=(), microphone=(), camera=()");
    return new Response(res.body, { status: res.status, headers: h });
  } catch (e) {
    console.error(e);
    return json({ ok: false, err: "server-error" }, { status: 500 });
  }
});
