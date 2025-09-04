// server.js — Quantum Dashboard Pro v6.4.1 (PROD)
// PWA fallback, auth via token->cookie, KV, Assist actions, AI router (Claude/OpenAI/Gemini/Mistral/OpenRouter/Ollama)

import { serveFile } from "https://deno.land/std@0.224.0/http/file_server.ts";

const VERSION = "6.4.1";

// ===== ENV =====
const QDP_TOKEN        = Deno.env.get("QDP_TOKEN") ?? "";
const COOKIE_DAYS      = parseInt(Deno.env.get("QDP_COOKIE_DAYS") ?? "30", 10);
const AI_PROVIDER      = (Deno.env.get("QDP_AI_PROVIDER") ?? "").toLowerCase(); // anthropic|openai|google|mistral|openrouter|ollama
const AI_MODEL         = Deno.env.get("QDP_AI_MODEL") ?? "";                    // np. claude-3-..., gpt-4o-mini, gemini-1.5-pro-latest
const ANTHROPIC_KEY    = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const OPENAI_KEY       = Deno.env.get("OPENAI_API_KEY") ?? "";
const GOOGLE_KEY       = Deno.env.get("GOOGLE_API_KEY") ?? "";                  // generative-language
const MISTRAL_KEY      = Deno.env.get("MISTRAL_API_KEY") ?? "";
const OPENROUTER_KEY   = Deno.env.get("OPENROUTER_API_KEY") ?? "";
const OLLAMA_URL       = Deno.env.get("OLLAMA_URL") ?? "http://127.0.0.1:11434";

// ===== KV =====
const kv = await (async () => { try { return await Deno.openKv(); } catch { return null; } })();

// ===== utils =====
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
const timeout = (ms) => new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms));

// ===== static/PWA =====
async function serveStatic(req) {
  const url = new URL(req.url);
  const pathname = decodeURIComponent(url.pathname);
  const staticWhitelist = new Set([
    "/", "/index.html",
    "/manifest.webmanifest", "/sw.js",
    "/logo-light.svg", "/logo-192.png", "/logo-512.png", "/logo-maskable.png",
    "/favicon.ico", "/robots.txt", "/sitemap.xml"
  ]);
  if (staticWhitelist.has(pathname)) {
    const file = pathname === "/" ? "/index.html" : pathname;
    try { return await serveFile(req, `.${file}`); } catch {}
  }
  if (pathname.includes(".")) {
    try { return await serveFile(req, `.${pathname}`); } catch {}
  }
  try {
    const res = await serveFile(req, "./index.html");
    const h = new Headers(res.headers);
    h.set("cache-control", "no-store");
    return new Response(res.body, { status: 200, headers: h });
  } catch { return notFound(); }
}

// ===== Assist actions (Make-style) =====
const Actions = {
  "projects.syncKV": async () => {
    if (!kv) return { ok: false, err: "kv-disabled" };
    return { ok: true, ts: Date.now() };
  },
  "projects.verifyHead": async ({ url }) => {
    try {
      const r = await fetch(url, { method: "HEAD" });
      return { ok: r.ok, status: r.status, headers: Object.fromEntries(r.headers) };
    } catch (e) { return { ok: false, err: String(e) }; }
  },
  "deploy.webhook": async ({ url, secret }) => {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-qdp-secret": secret || "" },
        body: JSON.stringify({ ts: Date.now(), source: "qdp" }),
      });
      return { ok: r.ok, status: r.status, body: await r.text() };
    } catch (e) { return { ok: false, err: String(e) }; }
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

// ===== AI Router =====
async function aiChatRouter({ provider, model, messages, temperature = 0.2 }) {
  provider = (provider || AI_PROVIDER || "").toLowerCase();
  model = model || AI_MODEL || "";

  // Anthropic (Claude)
  if (provider === "anthropic") {
    if (!ANTHROPIC_KEY) return { ok: false, err: "missing ANTHROPIC_API_KEY" };
    const m = model || "claude-3-5-sonnet-20240620";
    const body = {
      model: m, max_tokens: 2048, temperature,
      messages: (messages || []).map(msg => ({
        role: msg.role === "system" ? "user" : msg.role,
        content: [{ type: "text", text: msg.content }]
      }))
    };
    const r = await Promise.race([
      fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify(body)
      }),
      timeout(30000)
    ]);
    if (!r.ok) return { ok: false, err: `anthropic ${r.status}`, detail: await r.text() };
    const j = await r.json(); const text = j?.content?.[0]?.text ?? "";
    return { ok: true, provider: "anthropic", model: m, text, raw: j };
  }

  // OpenAI
  if (provider === "openai") {
    if (!OPENAI_KEY) return { ok: false, err: "missing OPENAI_API_KEY" };
    const m = model || "gpt-4o-mini";
    const r = await Promise.race([
      fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", "authorization": `Bearer ${OPENAI_KEY}` },
        body: JSON.stringify({ model: m, temperature, messages })
      }),
      timeout(30000)
    ]);
    if (!r.ok) return { ok: false, err: `openai ${r.status}`, detail: await r.text() };
    const j = await r.json(); const text = j?.choices?.[0]?.message?.content ?? "";
    return { ok: true, provider: "openai", model: m, text, raw: j };
  }

  // Google (Gemini)
  if (provider === "google") {
    if (!GOOGLE_KEY) return { ok: false, err: "missing GOOGLE_API_KEY" };
    const m = model || "gemini-1.5-pro-latest";
    const prompt = (messages || []).map(x => `${x.role.toUpperCase()}: ${x.content}`).join("\n");
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent?key=${GOOGLE_KEY}`;
    const r = await Promise.race([
      fetch(endpoint, {
        method: "POST", headers: {"content-type":"application/json"},
        body: JSON.stringify({ contents:[{ role:"user", parts:[{ text: prompt }]}], generationConfig:{ temperature } })
      }),
      timeout(30000)
    ]);
    if (!r.ok) return { ok: false, err: `google ${r.status}`, detail: await r.text() };
    const j = await r.json(); const text = j?.candidates?.[0]?.content?.parts?.map(p=>p.text).join("") ?? "";
    return { ok: true, provider: "google", model: m, text, raw: j };
  }

  // Mistral
  if (provider === "mistral") {
    if (!MISTRAL_KEY) return { ok: false, err: "missing MISTRAL_API_KEY" };
    const m = model || "mistral-large-latest";
    const r = await Promise.race([
      fetch("https://api.mistral.ai/v1/chat/completions", {
        method: "POST",
        headers: { "content-type":"application/json", "authorization": `Bearer ${MISTRAL_KEY}` },
        body: JSON.stringify({ model: m, temperature, messages })
      }),
      timeout(30000)
    ]);
    if (!r.ok) return { ok: false, err: `mistral ${r.status}`, detail: await r.text() };
    const j = await r.json(); const text = j?.choices?.[0]?.message?.content ?? "";
    return { ok: true, provider: "mistral", model: m, text, raw: j };
  }

  // OpenRouter
  if (provider === "openrouter") {
    if (!OPENROUTER_KEY) return { ok: false, err: "missing OPENROUTER_API_KEY" };
    const m = model || "anthropic/claude-3.5-sonnet";
    const r = await Promise.race([
      fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { "content-type":"application/json", "authorization": `Bearer ${OPENROUTER_KEY}`, "x-title": "Quantum Dashboard" },
        body: JSON.stringify({ model: m, temperature, messages })
      }),
      timeout(30000)
    ]);
    if (!r.ok) return { ok: false, err: `openrouter ${r.status}`, detail: await r.text() };
    const j = await r.json(); const text = j?.choices?.[0]?.message?.content ?? "";
    return { ok: true, provider: "openrouter", model: m, text, raw: j };
  }

  // Ollama (lokalnie)
  if (provider === "ollama") {
    const m = model || "llama3.1";
    const r = await Promise.race([
      fetch(`${OLLAMA_URL}/v1/chat/completions`, {
        method: "POST", headers: { "content-type":"application/json" },
        body: JSON.stringify({ model: m, messages, temperature })
      }),
      timeout(30000)
    ]);
    if (!r.ok) return { ok: false, err: `ollama ${r.status}`, detail: await r.text() };
    const j = await r.json(); const text = j?.choices?.[0]?.message?.content ?? "";
    return { ok: true, provider: "ollama", model: m, text, raw: j };
  }

  return { ok: false, err: "unknown-provider", hint: "Set QDP_AI_PROVIDER in ENV" };
}

// ===== API router =====
async function handleApi(req) {
  const { pathname, searchParams } = new URL(req.url);

  if (pathname === "/version") {
    return json({
      ok: true, version: VERSION, kv: !!kv,
      flags: { email: false, license: true, forward: false },
      ai: { provider: AI_PROVIDER || null, model: AI_MODEL || null }
    });
  }
  if (pathname === "/healthz") {
    if (QDP_TOKEN && !hasAuth(req)) return json({ ok: false, err: "unauthorized" }, { status: 401 });
    return json({ ok: true, ts: Date.now() });
  }

  // token -> cookie
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

  // KV
  if (pathname.startsWith("/api/kv/") && kv) {
    if (QDP_TOKEN && !hasAuth(req)) return json({ ok: false, err: "unauthorized" }, { status: 401 });
    const key = pathname.replace("/api/kv/", "");
    if (req.method === "GET")  { const r = await kv.get(["qdp", key]); return json({ ok: true, value: r.value ?? null }); }
    if (req.method === "POST") { const body = await req.json().catch(() => ({})); await kv.set(["qdp", key], body); return json({ ok: true }); }
    if (req.method === "DELETE") { await kv.delete(["qdp", key]); return json({ ok: true }); }
  }

  // Assist
  if (pathname === "/api/assist/run" && req.method === "POST") {
    if (QDP_TOKEN && !hasAuth(req)) return json({ ok: false, err: "unauthorized" }, { status: 401 });
    const { action, params } = await req.json().catch(() => ({}));
    if (!action || !(action in Actions)) return json({ ok: false, err: "unknown-action" }, { status: 400 });
    const out = await Actions[action](params || {});
    return json(out);
  }

  // AI chat
  if (pathname === "/api/ai/chat" && req.method === "POST") {
    if (QDP_TOKEN && !hasAuth(req)) return json({ ok: false, err: "unauthorized" }, { status: 401 });
    const body = await req.json().catch(() => ({}));
    const out = await aiChatRouter({
      provider: body.provider, model: body.model,
      messages: body.messages, temperature: body.temperature
    });
    return json(out, { status: out.ok ? 200 : 400 });
  }

  return null;
}

// ===== HTTP server =====
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
