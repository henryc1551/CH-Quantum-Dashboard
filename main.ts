// Quantum Edge Hub Supreme — Enterprise+++ (REAL, Full)
// Auth + Roles + Chat(WS) + Forms + KV + S3/R2 presign (PUT+GET) + Static
// Stripe (Checkout + Webhook + 12m revenue), GA4 MP, YouTube Data (+ OAuth Analytics opc.), IG Graph,
// TikTok Ads (PRO report), Meta Ads Insights, Cloudflare Turnstile + Zone Analytics,
// Projects Workspace (R2/S3), Chat Commands, Marketing Aggregate
// NEW: OpenAI Chat (SSE streaming) + ElevenLabs TTS (stream + cache do R2/S3)
// Deno Deploy ready.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { serveDir } from "https://deno.land/std@0.224.0/http/file_server.ts";

const kv = await Deno.openKv();
const enc = new TextEncoder(); const dec = new TextDecoder();

/* ===== Utils ===== */
function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    headers: { "content-type": "application/json; charset=utf-8", ...(init.headers || {}) },
    status: init.status ?? 200,
  });
}
async function readJSON(req: Request): Promise<any> {
  const ct = req.headers.get("content-type") || "";
  if (ct.includes("application/json")) { try { return await req.json(); } catch { return {}; } }
  const t = await req.text(); try { return JSON.parse(t); } catch { return {}; }
}
async function readRaw(req: Request): Promise<Uint8Array> { return new Uint8Array(await req.arrayBuffer()); }
function toHex(bytes: Uint8Array): string { return Array.from(bytes).map(b=>b.toString(16).padStart(2,"0")).join(""); }
function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = btoa(String.fromCharCode(...b)); return s.replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}
function fromB64url(s: string): Uint8Array {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64); const out = new Uint8Array(bin.length);
  for (let i=0;i<bin.length;i++) out[i]=bin.charCodeAt(i); return out;
}
async function sha256(data: Uint8Array | string): Promise<Uint8Array> {
  const buf = typeof data === "string" ? enc.encode(data) : data;
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return new Uint8Array(digest);
}
async function hmacSHA256(keyBytes: Uint8Array, data: string | Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name:"HMAC", hash:"SHA-256" }, false, ["sign","verify"]);
  const sig = await crypto.subtle.sign("HMAC", key, typeof data === "string" ? enc.encode(data) : data);
  return new Uint8Array(sig);
}
async function hmacSHA256Hex(key: string, msg: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), {name:"HMAC", hash:"SHA-256"}, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(msg));
  return toHex(new Uint8Array(sig));
}
async function hashStr(s:string){ const d=await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)); return toHex(new Uint8Array(d)); }

/* ===== JWT/Auth ===== */
const JWT_SECRET = enc.encode(Deno.env.get("JWT_SECRET") || "dev-secret-change-me");
type Role = "owner"|"admin"|"user";
type JwtPayload = { sub?: string; role?: Role; exp?: number; iat?: number };
async function signJWT(payload: JwtPayload): Promise<string> {
  const header = { alg:"HS256", typ:"JWT" }; const iat = Math.floor(Date.now()/1000);
  const p1 = b64url(enc.encode(JSON.stringify(header)));
  const p2 = b64url(enc.encode(JSON.stringify({ ...payload, iat })));
  const sig = await hmacSHA256(JWT_SECRET, `${p1}.${p2}`);
  return `${p1}.${p2}.${b64url(sig)}`;
}
async function verifyJWT(token?: string): Promise<JwtPayload|null> {
  if(!token) return null;
  const [p1,p2,p3]=token.split("."); if(!p1||!p2||!p3) return null;
  const sig = await hmacSHA256(JWT_SECRET, `${p1}.${p2}`); if(b64url(sig)!==p3) return null;
  const payload = JSON.parse(dec.decode(fromB64url(p2))) as JwtPayload;
  if(payload.exp && payload.exp < Math.floor(Date.now()/1000)) return null; return payload;
}
function getCookie(req: Request, name: string): string|undefined {
  const c=req.headers.get("cookie")||""; const m=c.match(new RegExp(`(?:^|; )${name}=([^;]*)`)); return m ? decodeURIComponent(m[1]) : undefined;
}
function setAuthCookie(token: string): Headers {
  const h=new Headers(); h.append("set-cookie",`token=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`); return h;
}

/* ===== Storage (R2/S3) presign PUT + GET ===== */
const S3_ACCESS_KEY = Deno.env.get("S3_ACCESS_KEY") || "";
const S3_SECRET_KEY = Deno.env.get("S3_SECRET_KEY") || "";
const S3_REGION     = Deno.env.get("S3_REGION")     || "auto";
const S3_BUCKET     = Deno.env.get("S3_BUCKET")     || "";
const S3_ENDPOINT   = Deno.env.get("S3_ENDPOINT")   || "";
const STORAGE_PROVIDER = (Deno.env.get("STORAGE_PROVIDER") || "").toLowerCase();

function s3BaseAndHost(objectKey="") {
  const base = S3_ENDPOINT ? new URL(S3_ENDPOINT).origin
    : (STORAGE_PROVIDER==="r2"?`https://${S3_BUCKET}.r2.cloudflarestorage.com`:"https://s3.amazonaws.com");
  const url = new URL(`${base}/${S3_BUCKET}/${objectKey}`);
  return { base, host: url.host, canonicalUri:`/${S3_BUCKET}/${encodeURI(objectKey)}` };
}
async function awsSigV4Presign(method:"GET"|"PUT", objectKey: string, contentType: string, expiresSeconds=900) {
  if(!S3_ACCESS_KEY||!S3_SECRET_KEY||!S3_BUCKET) throw new Error("Storage not configured");
  const now=new Date(); const amzDate=now.toISOString().replace(/[:-]|\.\d{3}/g,"").slice(0,15)+"Z"; const date=amzDate.slice(0,8);
  const service="s3"; const region=S3_REGION || (STORAGE_PROVIDER==="r2" ? "auto" : "us-east-1");
  const { base, host, canonicalUri } = s3BaseAndHost(objectKey);
  const algorithm="AWS4-HMAC-SHA256"; const credentialScope=`${date}/${region}/${service}/aws4_request`;
  const signedHeaders="host;x-amz-content-sha256;x-amz-date"; const payloadHash=await sha256("");
  const q=new URLSearchParams({"X-Amz-Algorithm":algorithm,"X-Amz-Credential":`${S3_ACCESS_KEY}/${credentialScope}`,"X-Amz-Date":amzDate,"X-Amz-Expires":String(expiresSeconds),"X-Amz-SignedHeaders":signedHeaders});
  const canonicalQuerystring=q.toString();
  const canonicalHeaders=`host:${host}\n`+`x-amz-content-sha256:${b64url(payloadHash)}\n`+`x-amz-date:${amzDate}\n`;
  const canonicalRequest=[method,canonicalUri,canonicalQuerystring,canonicalHeaders,signedHeaders,b64url(payloadHash)].join("\n");
  const stringToSign=[algorithm,amzDate,credentialScope,b64url(await sha256(enc.encode(canonicalRequest)))].join("\n");
  const kDate=await hmacSHA256(enc.encode("AWS4"+S3_SECRET_KEY),date);
  const kRegion=await hmacSHA256(kDate,region);
  const kService=await hmacSHA256(kRegion,service);
  const kSigning=await hmacSHA256(kService,"aws4_request");
  const signature=b64url(await hmacSHA256(kSigning,stringToSign)).replace(/-/g,"").replace(/_/g,"");
  const url=`${base}/${S3_BUCKET}/${objectKey}?${canonicalQuerystring}&X-Amz-Signature=${signature}`;
  return { url, headers: method==="PUT" ? { "content-type": contentType } : undefined };
}
const presignPut = (k:string,ct:string,exp=900)=>awsSigV4Presign("PUT",k,ct,exp);
const presignGet = (k:string,exp=900)=>awsSigV4Presign("GET",k,"",exp);

/* ===== Routes registry ===== */
type H = (req: Request, url: URL) => Promise<Response> | Response;
const R: Record<string, Record<string, H>> = { GET:{}, POST:{}, PUT:{}, DELETE:{} };
function route(m: keyof typeof R, p: string, h: H){ R[m][p]=h; }

/* ===== Users & Roles ===== */
type User = { email:string; pass:string; role:Role; createdAt:number; };
async function getUser(email:string){ return (await kv.get<User>(["user",email])).value||null; }
async function putUser(u:User){ await kv.set(["user",u.email],u); }
route("POST","/api/admin/bootstrap", async(req)=>{
  const b=await readJSON(req); const email=(b.email||"owner@local").toLowerCase(); const password=b.password||"przyjazn";
  if(await getUser(email)) return json({ok:true,msg:"Owner exists"});
  await putUser({email,pass:password,role:"owner",createdAt:Date.now()}); return json({ok:true,msg:"Owner created",email});
});
route("POST","/api/auth/register", async(req)=>{
  const b=await readJSON(req); const email=String(b.email||"").toLowerCase().trim(); const password=String(b.password||"");
  if(!email||!password) return json({ok:false,error:"email & password required"},{status:400});
  if(await getUser(email)) return json({ok:false,error:"user exists"},{status:409});
  await putUser({email,pass:password,role:"user",createdAt:Date.now()}); return json({ok:true});
});
route("POST","/api/auth/login", async(req)=>{
  const b=await readJSON(req); const email=String(b.email||"").toLowerCase().trim(); const password=String(b.password||"");
  const u=await getUser(email); if(!u||u.pass!==password) return json({ok:false,error:"invalid credentials"},{status:401});
  const token=await signJWT({sub:email,role:u.role,exp:Math.floor(Date.now()/1000)+60*60*24*30});
  const headers=setAuthCookie(token); headers.set("content-type","application/json; charset=utf-8"); return new Response(JSON.stringify({ok:true}),{headers});
});
route("POST","/api/auth/logout", async()=>{ const h=new Headers(); h.append("set-cookie","token=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0"); return json({ok:true},{headers:h}); });
route("GET","/api/me", async(req)=>{ const t=getCookie(req,"token")||(req.headers.get("authorization")?.split(" ")[1]??""); const p=await verifyJWT(t); return json({ok:!!p,user:p?{email:p.sub,role:p.role}:null}); });

/* ===== Rate Limit ===== */
async function rateLimit(keyBase: string, limit=60, windowSec=60) {
  const key = ["rl", keyBase, Math.floor(Date.now()/1000/windowSec)];
  const cur = (await kv.get<number>(key)).value || 0;
  if (cur >= limit) return false;
  await kv.set(key, cur + 1, { expireIn: windowSec * 1000 });
  return true;
}

/* ===== Forms ===== */
route("POST","/api/forms/submit", async(req)=>{
  const ip = req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "0.0.0.0";
  if (!(await rateLimit(`forms:${ip}`, 60, 60))) return json({ ok:false, error:"rate-limited" }, { status: 429 });
  const payload=await readJSON(req); const id=crypto.randomUUID(); await kv.set(["forms",id],{id,ts:Date.now(),payload}); return json({ok:true,id});
});
route("GET","/api/forms/list", async()=>{ const arr:any[]=[]; for await(const e of kv.list({prefix:["forms"]})) arr.push(e.value); return json({ok:true,items:arr}); });

/* ===== Storage presign API ===== */
route("POST","/api/storage/sign", async(req)=>{
  try{
    const b=await readJSON(req);
    const key=String(b.key||`uploads/${crypto.randomUUID()}`);
    const type=String(b.contentType||"application/octet-stream");
    const r=await presignPut(key,type,900);
    return json({ok:true,...r,provider:STORAGE_PROVIDER||"none"});
  }catch(e){ return json({ok:false,error:String(e?.message||e)},{status:400}); }
});
route("POST","/api/storage/sign-get", async(req)=>{
  try{
    const b=await readJSON(req); const key=String(b.key||"");
    if(!key) return json({ok:false,error:"key required"},{status:400});
    const r=await presignGet(key, 300);
    return json({ok:true,...r});
  }catch(e){ return json({ok:false,error:String(e?.message||e)},{status:400}); }
});

/* ===== Chat WS + history ===== */
const sockets=new Set<WebSocket>();
route("GET","/ws", async(req)=>{
  const {socket,response}=Deno.upgradeWebSocket(req);
  socket.onopen=()=>sockets.add(socket);
  socket.onmessage=async(ev)=>{ try{
    const msg=typeof ev.data==="string"?JSON.parse(ev.data):{text:String(ev.data)};
    const rec={id:crypto.randomUUID(),ts:Date.now(),...msg}; await kv.set(["chat",rec.id],rec);
    for(const s of sockets) try{s.send(JSON.stringify(rec))}catch{}
  }catch{} };
  socket.onclose=()=>sockets.delete(socket); socket.onerror=()=>sockets.delete(socket); return response;
});
route("GET","/api/chat/history", async()=>{ const items:any[]=[]; for await(const e of kv.list({prefix:["chat"]})) items.push(e.value); items.sort((a,b)=>a.ts-b.ts); return json({ok:true,items}); });

/* ===== Metrics + Health ===== */
route("GET","/api/metrics", async()=>{ const total=(await kv.get<number>(["metrics","hits"])).value||0; const visitors=(await kv.get<number>(["metrics","visitors"])).value||0; return json({ok:true,totalHits:total,uniqueIPs:visitors}); });
route("GET","/api/health",  async()=> json({ ok:true, ts: Date.now() }));

/* ===== Admin export ===== */
const ADMIN_TOKEN = Deno.env.get("ADMIN_TOKEN") || "";
route("POST","/api/admin/export", async(req)=>{
  if((req.headers.get("x-admin-token")||"") !== ADMIN_TOKEN) return json({ok:false,error:"forbidden"},{status:403});
  const dump: Record<string,unknown> = {};
  for await (const entry of kv.list({ prefix: [] })) dump[JSON.stringify(entry.key)] = entry.value;
  return json({ ok:true, ts: Date.now(), dump });
});

/* ===== Admin SSR ===== */
const ADMIN_HTML = (email:string, role:Role) => `<!doctype html>
<html lang="pl"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Admin • Quantum Edge Hub Supreme</title>
<link rel="stylesheet" href="/style.css"/></head>
<body><main class="grid">
<section class="card"><h3>👑 Admin</h3>
<p>Zalogowano jako: <b>${email}</b> (${role})</p>
<div class="row">
  <input id="uemail" placeholder="email użytkownika do zmiany roli"/>
  <select id="urole"><option>user</option><option>admin</option><option>owner</option></select>
  <button id="setRole">Ustaw rolę</button>
</div>
<pre id="log" class="muted">–</pre>
</section>
<section class="card"><h3>🧰 Narzędzia</h3>
<div class="row"><a href="/dashboard/" class="badge">→ Dashboard</a><a href="/marketing/" class="badge">→ Marketing</a><a href="/projects/" class="badge">→ Projects</a><a href="/assistant/" class="badge">→ Assistant</a></div>
</section></main>
<script type="module">
const $=(id)=>document.getElementById(id);
$("setRole").onclick=async()=>{
  const r=await fetch("/api/admin/users/role",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email:$("uemail").value,role:$("urole").value})});
  $("log").textContent=await r.text();
};
</script></body></html>`;
route("GET","/admin", async(req)=>{
  const t=getCookie(req,"token")||(req.headers.get("authorization")?.split(" ")[1]??""); const me=await verifyJWT(t);
  if(!me || (me.role!=="owner" && me.role!=="admin")) return json({ok:false,error:"forbidden"},{status:403});
  return new Response(ADMIN_HTML(String(me.sub), me.role||"user"), { headers: { "content-type":"text/html; charset=utf-8", "cache-control":"no-store" } });
});

/* ===== Stripe (summary + checkout + webhook) ===== */
const STRIPE_SECRET = Deno.env.get("STRIPE_SECRET") || "";
const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") || "";
const STRIPE_MONTHS = Number(Deno.env.get("STRIPE_MONTHS") || "12");
async function stripeFetch(path: string, params?: Record<string, string|number|boolean>) {
  if (!STRIPE_SECRET) throw new Error("STRIPE_SECRET not configured");
  const url = new URL(`https://api.stripe.com${path}`);
  if (params) for (const [k,v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const r = await fetch(url, { headers: { "authorization": `Bearer ${STRIPE_SECRET}` } }); if (!r.ok) throw new Error(`Stripe ${path} ${r.status}`);
  return r.json();
}
route("GET", "/api/integrations/stripe/summary", async () => {
  try {
    if (!STRIPE_SECRET) return json({ ok:false, error:"No STRIPE_SECRET" }, { status:400 });
    const now = new Date();
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (STRIPE_MONTHS - 1), 1));
    const createdGte = Math.floor(from.getTime()/1000);
    const months: Record<string, number> = {}; let starting_after: string | undefined;
    for (;;) {
      const page:any = await stripeFetch("/v1/charges", { limit: 100, "created[gte]": createdGte, starting_after: starting_after ?? "" });
      for (const c of page.data) {
        if (!c.paid || c.refunded) continue;
        const d = new Date((c.created||0)*1000); const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}`;
        months[key] = (months[key] || 0) + (c.amount || 0);
      }
      if (!page.has_more) break; starting_after = page.data[page.data.length-1].id;
    }
    const series=[]; for (let i=STRIPE_MONTHS-1; i>=0; i--) { const d=new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth()-i, 1)); const key=`${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}`; series.push({ month:key, value: Math.round((months[key]||0)/100) }); }
    const total = series.reduce((a,b)=>a+b.value,0); const mrr = series.at(-1)?.value ?? 0; const prev = series.at(-2)?.value ?? 0; const growthMoM = prev ? Math.round((mrr - prev)/prev*100) : 0;
    return json({ ok:true, series, total12m: total, mrr, growthMoM });
  } catch (e) { return json({ ok:false, error:String(e?.message||e) }, { status:500 }); }
});
route("POST","/api/stripe/checkout/create", async (req)=>{
  try{
    if (!STRIPE_SECRET) return json({ ok:false, error:"No STRIPE_SECRET" }, { status:400 });
    const b = await readJSON(req);
    const priceId = String(b.priceId || ""); const mode = String(b.mode || "payment");
    const host = (new URL(req.url)).host;
    const success = String(b.successUrl || `https://${host}/marketing/`);
    const cancel = String(b.cancelUrl || `https://${host}/marketing/`);
    if (!priceId) return json({ ok:false, error:"priceId required" }, { status:400 });
    const form = new URLSearchParams(); form.set("mode", mode); form.set("success_url", success); form.set("cancel_url", cancel);
    form.append("line_items[0][price]", priceId); form.append("line_items[0][quantity]", "1");
    if (b.customerEmail) form.set("customer_email", String(b.customerEmail));
    const r = await fetch("https://api.stripe.com/v1/checkout/sessions", { method:"POST", headers:{ "authorization":`Bearer ${STRIPE_SECRET}`, "content-type":"application/x-www-form-urlencoded" }, body: form });
    const j = await r.json(); if (r.status !== 200) return json({ ok:false, error:j.error?.message||"Stripe error", raw:j }, { status:r.status });
    return json({ ok:true, id: j.id, url: j.url });
  }catch(e){ return json({ ok:false, error:String(e?.message||e) }, { status:500 }); }
});
function parseStripeSig(h: string) { const parts = h.split(",").map(p=>p.trim()); const out: Record<string,string> = {}; for(const p of parts){ const [k,v] = p.split("="); if(k&&v) out[k]=v; } return { t: out["t"], v1: out["v1"] }; }
route("POST","/api/stripe/webhook", async (req) => {
  if (!STRIPE_WEBHOOK_SECRET) return json({ ok:false, error:"No STRIPE_WEBHOOK_SECRET" }, { status:400 });
  const sig = req.headers.get("stripe-signature") || ""; const { t, v1 } = parseStripeSig(sig);
  if (!t || !v1) return json({ ok:false, error:"Bad signature header" }, { status:400 });
  const raw = await readRaw(req); const signedPayload = `${t}.${new TextDecoder().decode(raw)}`;
  const check = await hmacSHA256Hex(STRIPE_WEBHOOK_SECRET, signedPayload);
  if (check !== v1) return json({ ok:false, error:"Signature mismatch" }, { status:400 });
  const event = JSON.parse(new TextDecoder().decode(raw));
  await kv.set(["stripe","events", event.id], { ts: Date.now(), type: event.type, data: event.data }, { expireIn: 1000*60*60*24*90 });
  return json({ received: true });
});

/* ===== GA4 MP ===== */
const GA4_MEASUREMENT_ID = Deno.env.get("GA4_MEASUREMENT_ID") || "";
const GA4_API_SECRET     = Deno.env.get("GA4_API_SECRET") || "";
route("POST","/api/ga4/collect", async (req)=>{
  try{
    if (!GA4_MEASUREMENT_ID || !GA4_API_SECRET) return json({ ok:false, error:"GA4 env missing" }, { status:400 });
    const payload = await readJSON(req);
    const url = `https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(GA4_MEASUREMENT_ID)}&api_secret=${encodeURIComponent(GA4_API_SECRET)}`;
    const r = await fetch(url, { method:"POST", headers:{ "content-type":"application/json" }, body: JSON.stringify(payload) });
    const txt = await r.text(); return new Response(txt, { status: r.status, headers: { "content-type":"application/json; charset=utf-8" } });
  }catch(e){ return json({ ok:false, error:String(e?.message||e) }, { status:500 }); }
});

/* ===== YouTube / IG / TikTok / Meta / Cloudflare ===== */
const YOUTUBE_API_KEY   = Deno.env.get("YOUTUBE_API_KEY") || "";
const YOUTUBE_CHANNEL_ID= Deno.env.get("YOUTUBE_CHANNEL_ID") || "";
route("GET","/api/integrations/youtube/channel", async ()=>{
  try{
    if(!YOUTUBE_API_KEY || !YOUTUBE_CHANNEL_ID) return json({ ok:false, error:"YouTube env missing" }, { status:400 });
    const url = `https://www.googleapis.com/youtube/v3/channels?part=statistics,snippet&id=${encodeURIComponent(YOUTUBE_CHANNEL_ID)}&key=${encodeURIComponent(YOUTUBE_API_KEY)}`;
    const r = await fetch(url); if(!r.ok) return json({ ok:false, error: `YT ${r.status}` }, { status:r.status });
    const j = await r.json(); const c = j.items?.[0]; if(!c) return json({ ok:false, error:"Channel not found" }, { status:404 });
    return json({ ok:true, title: c.snippet?.title, stats: c.statistics });
  }catch(e){ return json({ ok:false, error:String(e?.message||e) }, { status:500 }); }
});
const FB_ACCESS_TOKEN = Deno.env.get("FB_ACCESS_TOKEN") || "";
const IG_USER_ID      = Deno.env.get("IG_USER_ID") || "";
route("GET","/api/integrations/instagram/insights", async ()=>{
  try{
    if(!FB_ACCESS_TOKEN || !IG_USER_ID) return json({ ok:false, error:"IG env missing" }, { status:400 });
    const url = new URL(`https://graph.facebook.com/v17.0/${IG_USER_ID}/insights`);
    url.searchParams.set("metric","impressions,reach,profile_views"); url.searchParams.set("period","day"); url.searchParams.set("access_token", FB_ACCESS_TOKEN);
    const r = await fetch(url.toString()); if(!r.ok) return json({ ok:false, error:`IG ${r.status}` }, { status:r.status });
    const j = await r.json(); return json({ ok:true, data: j.data });
  }catch(e){ return json({ ok:false, error:String(e?.message||e) }, { status:500 }); }
});
const TIKTOK_ACCESS_TOKEN = Deno.env.get("TIKTOK_ACCESS_TOKEN") || "";
const TIKTOK_ADVERTISER_ID= Deno.env.get("TIKTOK_ADVERTISER_ID") || "";
route("GET","/api/integrations/tiktok/ads/overview", async ()=>{
  try{
    if(!TIKTOK_ACCESS_TOKEN || !TIKTOK_ADVERTISER_ID) return json({ ok:false, error:"TikTok env missing" }, { status:400 });
    const url = new URL("https://business-api.tiktok.com/open_api/v1.3/advertiser/info/");
    url.searchParams.set("advertiser_id", TIKTOK_ADVERTISER_ID);
    const r = await fetch(url.toString(), { headers: { "Access-Token": TIKTOK_ACCESS_TOKEN, "Content-Type": "application/json" } });
    const j = await r.json(); if(j.code && j.code !== 0) return json({ ok:false, error:j.message || "TikTok error", raw:j }, { status:502 });
    return json({ ok:true, advertiser: j.data?.advertiser_info || j.data });
  }catch(e){ return json({ ok:false, error:String(e?.message||e) }, { status:500 }); }
});
route("POST","/api/integrations/tiktok/ads/report-adv", async (req)=>{
  try{
    if(!TIKTOK_ACCESS_TOKEN || !TIKTOK_ADVERTISER_ID) return json({ ok:false, error:"TikTok env missing" }, { status:400 });
    const b = await readJSON(req);
    const start = String(b.start || new Date(Date.now()-7*24*3600*1000).toISOString().slice(0,10));
    const end   = String(b.end   || new Date().toISOString().slice(0,10));
    const dimensions = Array.isArray(b.dimensions)&&b.dimensions.length?b.dimensions:["stat_time_day","campaign_id","adgroup_id","country_code","placement"];
    const metrics = Array.isArray(b.metrics)&&b.metrics.length?b.metrics:["spend","impressions","reach","clicks","ctr","cpm","cpc","conversions"];
    const body = { advertiser_id: TIKTOK_ADVERTISER_ID, report_type: "BASIC", data_level: "AUCTION_ADVERTISER", dimensions, metrics, time_range: { start_date: start, end_date: end } };
    const r = await fetch("https://business-api.tiktok.com/open_api/v1.3/report/integrated/get/", { method:"POST", headers:{ "Access-Token": TIKTOK_ACCESS_TOKEN, "Content-Type":"application/json" }, body: JSON.stringify(body) });
    const j = await r.json(); if(j.code && j.code!==0) return json({ ok:false, error:j.message||"TikTok error", raw:j }, { status:502 });
    return json({ ok:true, start, end, dimensions, metrics, report: j.data });
  }catch(e){ return json({ ok:false, error:String(e?.message||e) }, { status:500 }); }
});
const META_ACCESS_TOKEN = Deno.env.get("META_ACCESS_TOKEN") || "";
const META_AD_ACCOUNT_ID= Deno.env.get("META_AD_ACCOUNT_ID") || "";
async function metaGet(path: string, qs: Record<string,string> = {}) {
  if (!META_ACCESS_TOKEN || !META_AD_ACCOUNT_ID) throw new Error("Meta env missing");
  const url = new URL(`https://graph.facebook.com/v18.0/${path}`);
  url.searchParams.set("access_token", META_ACCESS_TOKEN);
  for (const [k,v] of Object.entries(qs)) url.searchParams.set(k, v);
  const r = await fetch(url.toString()); if (!r.ok) throw new Error(`Meta ${path} ${r.status}`);
  return r.json();
}
route("GET","/api/integrations/meta/ads/report", async (req)=>{
  try{
    if(!META_ACCESS_TOKEN || !META_AD_ACCOUNT_ID) return json({ ok:false, error:"Meta env missing" }, { status:400 });
    const u = new URL(req.url);
    const start = u.searchParams.get("start") || new Date(Date.now()-7*24*3600*1000).toISOString().slice(0,10);
    const end   = u.searchParams.get("end")   || new Date().toISOString().slice(0,10);
    const fields = (u.searchParams.get("fields") || "spend,impressions,clicks,ctr,cpm,cpc,actions,action_values,reach");
    const breakdowns = (u.searchParams.get("breakdowns") || "country,publisher_platform");
    const level = u.searchParams.get("level") || "campaign";
    const res = await metaGet(`${META_AD_ACCOUNT_ID}/insights`, {
      time_range: JSON.stringify({ since: start, until: end }), level, fields, breakdowns, limit: "5000"
    });
    return json({ ok:true, start, end, level, fields: fields.split(","), breakdowns: breakdowns.split(","), data: res.data, paging: res.paging });
  }catch(e){ return json({ ok:false, error:String(e?.message||e) }, { status:500 }); }
});
const CLOUDFLARE_TURNSTILE_SECRET = Deno.env.get("CLOUDFLARE_TURNSTILE_SECRET") || "";
route("POST","/api/turnstile/verify", async (req)=>{
  try{
    if(!CLOUDFLARE_TURNSTILE_SECRET) return json({ ok:false, error:"Turnstile secret missing" }, { status:400 });
    const b = await readJSON(req);
    const token = String(b.token || "");
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method:"POST",
      headers: {"content-type":"application/x-www-form-urlencoded"},
      body: new URLSearchParams({ secret: CLOUDFLARE_TURNSTILE_SECRET, response: token })
    });
    const j = await r.json(); return json({ ok: !!j.success, raw: j });
  }catch(e){ return json({ ok:false, error:String(e?.message||e) }, { status:500 }); }
});
const CF_API_TOKEN = Deno.env.get("CF_API_TOKEN") || "";
const CF_ZONE_ID   = Deno.env.get("CF_ZONE_ID") || "";
route("GET","/api/integrations/cloudflare/zone-analytics", async ()=>{
  try{
    if(!CF_API_TOKEN || !CF_ZONE_ID) return json({ ok:false, error:"CF env missing" }, { status:400 });
    const url = `https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/analytics/dashboard?since=-7d&continuous=true`;
    const r = await fetch(url, { headers: { "Authorization": `Bearer ${CF_API_TOKEN}` } });
    const j = await r.json(); if(!j.success) return json({ ok:false, error:"CF error", raw:j }, { status:502 });
    return json({ ok:true, totals: j.result?.totals, timeseries: j.result?.timeseries });
  }catch(e){ return json({ ok:false, error:String(e?.message||e) }, { status:500 }); }
});

/* ===== First-party analytics ===== */
route("POST","/api/ingest", async (req)=>{
  try{
    const b = await readJSON(req);
    const ip = req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "0.0.0.0";
    const ua = req.headers.get("user-agent") || "";
    const ipHash = await hashStr(ip + "|" + ua);
    const event = { id: crypto.randomUUID(), t: Date.now(), type: String(b.type || "view"), src: String(b.src || "web"), uid: b.uid ? String(b.uid) : undefined, meta: typeof b.meta === "object" ? b.meta : undefined, ipHash };
    await kv.set(["analytics", "events", event.id], event, { expireIn: 1000*60*60*24*90 });
    return json({ ok:true });
  }catch(e){ return json({ ok:false, error:String(e?.message||e) }, { status:400 }); }
});
route("GET","/api/reports/traffic", async (req)=>{
  const url = new URL(req.url);
  const days = Number(url.searchParams.get("days") || "30");
  const since = Date.now() - days*24*3600*1000;
  const buckets: Record<string, Record<string, number>> = {};
  for await (const e of kv.list({ prefix: ["analytics","events"] })) {
    const ev:any = e.value;
    if (!ev?.t || ev.t < since) continue;
    const d = new Date(ev.t);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}-${String(d.getUTCDate()).padStart(2,"0")}`;
    const src = ev.src || "web";
    buckets[key] = buckets[key] || {};
    buckets[key][src] = (buckets[key][src] || 0) + 1;
  }
  return json({ ok:true, since, days, buckets });
});

/* ===== Projects Workspace (R2/S3) ===== */
type Project = { id:string; name:string; createdAt:number; status:"ready"|"empty"|"disabled" };
route("POST","/api/projects/create", async(req)=>{
  const b=await readJSON(req); const name=String(b.name||"").trim();
  if(!name) return json({ok:false,error:"name required"},{status:400});
  const id = name.toLowerCase().replace(/[^a-z0-9\-]+/g,"-").replace(/(^-+|-+$)/g,"") + "-" + crypto.randomUUID().slice(0,8);
  const p:Project={ id, name, createdAt:Date.now(), status:"empty" };
  await kv.set(["project",id], p);
  return json({ ok:true, project:p, uploadHint:{ signUploadEndpoint:"/api/projects/sign-upload", keyPrefix:`projects/${id}/` }});
});
route("POST","/api/projects/sign-upload", async(req)=>{
  const b=await readJSON(req); const id=String(b.id||""); const filename=String(b.filename||"index.html"); const ctype=String(b.contentType||"application/octet-stream");
  const proj=(await kv.get<Project>(["project",id])).value; if(!proj) return json({ok:false,error:"project not found"},{status:404});
  const key=`projects/${id}/${filename}`; const put=await presignPut(key, ctype, 900);
  return json({ ok:true, key, putUrl: put.url, headers: put.headers, previewUrl: `/projects/${id}/${encodeURIComponent(filename)}` });
});
route("GET","/api/projects/list", async()=>{
  const items:Project[]=[]; for await (const e of kv.list<Project>({prefix:["project"]})) items.push(e.value as Project);
  return json({ ok:true, items });
});

/* ===== Commands (chat control) ===== */
route("POST","/api/commands/execute", async(req)=>{
  const b=await readJSON(req); const text=String(b.text||"").trim();
  const m1 = text.match(/^\/?(create|stw[oó]rz)\s+projekt\s+(.+)$/i) || text.match(/^\/create\s+(.+)$/i);
  if (m1) {
    const name = (m1[2] ?? m1[1]).toString().replace(/^create\s+/i,"");
    const r = await fetch(new URL("/api/projects/create", req.url), { method:"POST", headers:{ "content-type":"application/json" }, body: JSON.stringify({ name }) });
    return new Response(await r.text(), { headers:{ "content-type":"application/json; charset=utf-8" }});
  }
  const m2 = text.match(/^\/sign\s+([a-z0-9\-]+)\s+(.+)$/i);
  if (m2) {
    const id=m2[1], filename=m2[2];
    const r = await fetch(new URL("/api/projects/sign-upload", req.url), { method:"POST", headers:{ "content-type":"application/json" }, body: JSON.stringify({ id, filename, contentType:"application/octet-stream" }) });
    return new Response(await r.text(), { headers:{ "content-type":"application/json; charset=utf-8" }});
  }
  if (/^\/projects$/i.test(text)) {
    const r = await fetch(new URL("/api/projects/list", req.url));
    return new Response(await r.text(), { headers:{ "content-type":"application/json; charset=utf-8" }});
  }
  return json({ ok:false, error:"Unknown command. Try: /create projekt <nazwa>, /sign <id> <plik>, /projects" }, { status:400 });
});

/* ===== OpenAI Chat (SSE streaming) ===== */
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") || "";
const OPENAI_MODEL   = Deno.env.get("OPENAI_MODEL") || "gpt-4o-mini";
const AI_SYSTEM_PROMPT = Deno.env.get("AI_SYSTEM_PROMPT") || "You are Leonie, a precise, helpful engineer-assistant. Be direct, practical, and safe.";
route("POST","/api/ai/chat", async (req)=>{
  try{
    if(!OPENAI_API_KEY) return json({ ok:false, error:"OPENAI_API_KEY missing" }, { status:400 });
    const ip = req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "0.0.0.0";
    if (!(await rateLimit(`ai:${ip}`, 120, 60))) return json({ ok:false, error:"rate-limited" }, { status:429 });

    const body = await readJSON(req);
    const stream = body.stream !== false; // domyślnie on
    const messages = Array.isArray(body.messages) ? body.messages.slice(0, 100) : [];
    if (AI_SYSTEM_PROMPT && !messages.find((m:any)=>m.role==="system")) messages.unshift({ role:"system", content: AI_SYSTEM_PROMPT });

    const payload = {
      model: body.model || OPENAI_MODEL,
      messages,
      temperature: body.temperature ?? 0.7,
      stream
    };

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method:"POST",
      headers:{ "authorization":`Bearer ${OPENAI_API_KEY}`, "content-type":"application/json" },
      body: JSON.stringify(payload)
    });

    if (stream) {
      const headers = new Headers({
        "content-type":"text/event-stream; charset=utf-8",
        "cache-control":"no-store",
        "connection":"keep-alive"
      });
      return new Response(r.body, { headers, status: 200 });
    } else {
      const j = await r.json();
      return json(j, { status: r.status });
    }
  } catch(e) {
    return json({ ok:false, error: String(e?.message||e) }, { status:500 });
  }
});

/* ===== ElevenLabs TTS (stream + cache do R2/S3) ===== */
const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_API_KEY") || "";
const ELEVENLABS_VOICE_ID = Deno.env.get("ELEVENLABS_VOICE_ID") || "21m00Tcm4TlvDq8ikWAM";
route("POST","/api/tts/speak", async (req)=>{
  try{
    if(!ELEVENLABS_API_KEY) return json({ ok:false, error:"ELEVENLABS_API_KEY missing" }, { status:400 });
    const b = await readJSON(req);
    const text = String(b.text || "").slice(0, 5000);
    if (!text) return json({ ok:false, error:"text required" }, { status:400 });
    const voice = String(b.voiceId || ELEVENLABS_VOICE_ID);
    const format = "mp3";
    const doCache = b.cache !== false;

    // Cache hit (R2/S3)
    if (doCache && S3_BUCKET) {
      const key = `tts-cache/${voice}/${await hashStr(text)}.${format}`;
      try {
        const g = await presignGet(key, 300);
        const head = await fetch(g.url, { method:"GET" });
        if (head.ok) return new Response(null, { status:302, headers:{ location: g.url, "cache-control":"no-store" } });
      } catch {}
    }

    // Stream from ElevenLabs
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}/stream?optimize_streaming_latency=3&output_format=mp3_44100_128`;
    const r = await fetch(url, {
      method:"POST",
      headers:{ "xi-api-key": ELEVENLABS_API_KEY, "content-type":"application/json" },
      body: JSON.stringify({ text, voice_settings: b.voice_settings })
    });
    if (!r.ok) {
      const err = await r.text();
      return json({ ok:false, error:`ElevenLabs ${r.status}`, raw: err }, { status:r.status });
    }
    const bytes = new Uint8Array(await r.arrayBuffer());

    // Cache save (R2/S3)
    if (doCache && S3_BUCKET) {
      try{
        const key = `tts-cache/${voice}/${await hashStr(text)}.${format}`;
        const put = await presignPut(key, "audio/mpeg", 900);
        await fetch(put.url, { method:"PUT", headers:{ "content-type":"audio/mpeg" }, body: bytes });
        const g = await presignGet(key, 300);
        return new Response(null, { status:302, headers:{ location: g.url, "cache-control":"no-store" } });
      }catch{}
    }

    return new Response(bytes, { headers:{ "content-type":"audio/mpeg", "cache-control":"no-store" } });
  } catch(e){
    return json({ ok:false, error: String(e?.message||e) }, { status:500 });
  }
});

/* ===== Marketing aggregate (skrót) ===== */
route("GET","/api/marketing/aggregate", async ()=>{
  const out: Record<string,unknown> = {};
  try{ out.stripe = await (await fetch("http://local/api/integrations/stripe/summary")).json(); }catch{}
  try{ out.youtube= await (await fetch("http://local/api/integrations/youtube/channel")).json(); }catch{}
  try{ out.tiktok = await (await fetch("http://local/api/integrations/tiktok/ads/overview")).json(); }catch{}
  try{
    if(META_ACCESS_TOKEN && META_AD_ACCOUNT_ID){
      const acct = await metaGet(`${META_AD_ACCOUNT_ID}`, { fields: "name,currency,amount_spent" });
      out.meta = { ok:true, account: acct };
    }
  }catch(e){ out.meta = { ok:false, error: String(e?.message||e) }; }
  return json({ ok:true, ts: Date.now(), services: out });
});

/* ===== CORS + Security + Metrics wrapper ===== */
function cors(req: Request, res: Response) {
  const h = new Headers(res.headers);
  const origin = req.headers.get("origin") || "*";
  h.set("access-control-allow-origin", origin);
  h.set("access-control-allow-credentials", "true");
  h.set("access-control-allow-headers", "content-type, authorization, x-admin-token");
  h.set("access-control-allow-methods", "GET,POST,PUT,DELETE,OPTIONS");
  return new Response(res.body, { status: res.status, headers: h });
}
function withSecurityHeaders(res: Response): Response {
  const h = new Headers(res.headers);
  h.set("x-frame-options", "DENY");
  h.set("x-content-type-options", "nosniff");
  h.set("referrer-policy", "strict-origin-when-cross-origin");
  h.set("permissions-policy", "geolocation=(), microphone=(), camera=()");
  h.set("strict-transport-security", "max-age=31536000; includeSubDomains; preload");
  h.set("content-security-policy",
    "default-src 'self'; connect-src 'self' https: wss:; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'");
  return new Response(res.body, { status: res.status, headers: h });
}
async function withMetrics(req: Request, fn: () => Promise<Response> | Response) {
  try {
    const ip = req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "0.0.0.0";
    await kv.atomic().sum(["metrics","hits"],1n).set(["metrics","ip",ip],Date.now()).commit();
    const ips:string[]=[]; for await(const e of kv.list({prefix:["metrics","ip"]})) ips.push(String(e.key[2]));
    await kv.set(["metrics","visitors"], new Set(ips).size);
  } catch {}
  return await fn();
}

/* ===== HTTP handler (redirects + dynamic projects) ===== */
const handler = async (req: Request): Promise<Response> => withMetrics(req, async ()=>{
  const url=new URL(req.url);

  if(req.method==="OPTIONS") return withSecurityHeaders(cors(req,new Response("ok")));

  if(req.method==="GET" && url.pathname==="/") {
    return withSecurityHeaders(cors(req, new Response(null, { status:302, headers:{ "location":"/dashboard/" } })));
  }

  // Dynamic projects via R2/S3 (signed GET)
  if (req.method==="GET" && url.pathname.startsWith("/projects/")) {
    const key = `projects${url.pathname.substring("/projects".length)}`.replace(/\/+/g,"/").replace(/^\/+/,"");
    try {
      const g = await presignGet(key, 120);
      return withSecurityHeaders(cors(req, new Response(null, { status:302, headers: { "location": g.url, "cache-control":"no-store" } })));
    } catch (e) {
      return withSecurityHeaders(cors(req, json({ ok:false, error: String(e?.message||e), key }, { status: 404 })));
    }
  }

  if(req.method==="GET" && url.pathname==="/ws"){ /* @ts-ignore */ const r=await R.GET["/ws"](req,url); return withSecurityHeaders(cors(req,r)); }

  const map=R[req.method as keyof typeof R]||{}; const h=map[url.pathname]; if(h) return withSecurityHeaders(cors(req,await h(req,url)));

  return withSecurityHeaders(await serveDir(req,{fsRoot:"public",urlRoot:""}));
});

console.log("Quantum Edge Hub Supreme — enterprise+++ listening on edge");
serve(handler);
