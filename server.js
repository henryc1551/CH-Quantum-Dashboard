// CH-Quantum Dashboard • v5.6.0 (FULL AUTO + Automation API)

const V = "5.6.0";

/* ================== ENV ==================
QDP_TOKEN
QDP_COOKIE_DAYS

# STRIPE
STRIPE_SECRET
STRIPE_WEBHOOK_SECRET
STRIPE_PRICE_ONETIME
STRIPE_PRICE_SUB
STRIPE_BILLING_PORTAL=true

# RESEND
RESEND_API_KEY
RESEND_FROM

# AUTOMATY (domyślne; mogą być nadpisane runtime)
AUTO_EMAIL_RECEIPT=true
AUTO_LICENSE=true

# ZEW. ERP/CRM FORWARD
OUTBOUND_WEBHOOK_URL
OUTBOUND_WEBHOOK_SECRET

# WŁASNA NUMERACJA
INVOICE_PREFIX=QD-
INVOICE_YEAR_IN_PREFIX=true
INVOICE_PADDING=6

# SCHEDULER
TASK_TOKEN

# CI/CD (opcjonalnie)
GITHUB_REPO
GITHUB_WORKFLOW_FILE=deploy.yml
GITHUB_TOKEN_PAT
=========================================== */

const ACCESS_TOKEN = (Deno.env.get("QDP_TOKEN") || "").trim();
const COOKIE_DAYS  = Math.max(1, parseInt(Deno.env.get("QDP_COOKIE_DAYS") || "30", 10));

const STRIPE_SECRET = (Deno.env.get("STRIPE_SECRET") || "").trim();
const STRIPE_WEBHOOK_SECRET = (Deno.env.get("STRIPE_WEBHOOK_SECRET") || "").trim();
const STRIPE_PRICE_ONETIME = (Deno.env.get("STRIPE_PRICE_ONETIME") || "").trim();
const STRIPE_PRICE_SUB = (Deno.env.get("STRIPE_PRICE_SUB") || "").trim();
const STRIPE_BILLING_PORTAL = (Deno.env.get("STRIPE_BILLING_PORTAL") || "true").trim() === "true";

const RESEND_API_KEY = (Deno.env.get("RESEND_API_KEY") || "").trim();
const RESEND_FROM = (Deno.env.get("RESEND_FROM") || "no-reply@example.com").trim();

const AUTO_EMAIL_RECEIPT_ENV = (Deno.env.get("AUTO_EMAIL_RECEIPT") || "true").trim() === "true";
const AUTO_LICENSE_ENV       = (Deno.env.get("AUTO_LICENSE") || "true").trim() === "true";

const OUTBOUND_WEBHOOK_URL    = (Deno.env.get("OUTBOUND_WEBHOOK_URL") || "").trim();
const OUTBOUND_WEBHOOK_SECRET = (Deno.env.get("OUTBOUND_WEBHOOK_SECRET") || "").trim();

const INVOICE_PREFIX          = (Deno.env.get("INVOICE_PREFIX") || "QD-").trim();
const INVOICE_YEAR_IN_PREFIX  = (Deno.env.get("INVOICE_YEAR_IN_PREFIX") || "true").trim() === "true";
const INVOICE_PADDING         = Math.max(3, parseInt(Deno.env.get("INVOICE_PADDING") || "6", 10));

const TASK_TOKEN = (Deno.env.get("TASK_TOKEN") || "").trim();

const GITHUB_REPO = (Deno.env.get("GITHUB_REPO") || "").trim();
const GITHUB_WORKFLOW_FILE = (Deno.env.get("GITHUB_WORKFLOW_FILE") || "deploy.yml").trim();
const GITHUB_TOKEN_PAT = (Deno.env.get("GITHUB_TOKEN_PAT") || "").trim();

const kv = await Deno.openKv();

/* ---------- utils ---------- */
const MIME = {
  ".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",".js":"application/javascript; charset=utf-8",
  ".json":"application/json; charset=utf-8",".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",".svg":"image/svg+xml",
  ".ico":"image/x-icon",".webmanifest":"application/manifest+json",".txt":"text/plain; charset=utf-8",".pdf":"application/pdf",".zip":"application/zip"
};
function sec(){ return {
  "x-content-type-options":"nosniff","referrer-policy":"strict-origin-when-cross-origin",
  "content-security-policy":"default-src 'self' 'unsafe-inline' data: blob:; connect-src 'self' https:; img-src 'self' data:; media-src 'self' https:; frame-ancestors 'none';",
  "x-robots-tag":"noindex, nofollow, noarchive",
  "access-control-allow-origin":"*","access-control-allow-methods":"GET,POST,OPTIONS",
  "access-control-allow-headers":"content-type,authorization,stripe-signature,x-hub-signature-256,x-qd-signature"
};}
function json(data,status=200,h={}){return new Response(JSON.stringify(data,null,2),{status,headers:{"content-type":"application/json; charset=utf-8",...sec(),...h}});}
function hex(buf){ return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,"0")).join(""); }
async function hmacHex(secret, data){
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), {name:"HMAC", hash:"SHA-256"}, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return hex(sig);
}
function qs(obj){ const b=new URLSearchParams(); for(const [k,v] of Object.entries(obj)) if(v!==undefined&&v!==null) b.set(k,String(v)); return b; }
const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));

/* ---------- gate / static ---------- */
const COOKIE_NAME="qd_auth";
function cookieSetHeader(days){ return `${COOKIE_NAME}=1; Path=/; Max-Age=${days*86400}; HttpOnly; SameSite=Lax`; }
function cookieClrHeader(){ return `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`; }
function hasCookie(req){ const c=req.headers.get("cookie")||""; return new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=1(?:;|$)`).test(c); }
function isPublic(u){ return ["/healthz","/version","/robots.txt","/landing.html","/landing-en.html","/manifest.webmanifest","/installer.html","/logout"].includes(u.pathname) || /^\/icon-/.test(u.pathname) || /^\/logo-/.test(u.pathname); }
function extractIncomingToken(req,u){
  const auth=req.headers.get("authorization")||""; const qtok=u.searchParams.get("token")||"";
  if (qtok) return qtok.trim();
  if (/^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i,"").trim();
  if (/^Basic\s+/i.test(auth)) { try{ const dec=atob(auth.replace(/^Basic\s+/i,"").trim()); const [,pass=""]=dec.split(":"); return pass.trim(); }catch{} }
  return "";
}
function loginHTML({error=""}={}){ const err=error?`<div class="err">${error}</div>`:"";
  return `<!doctype html><meta charset=utf-8><title>Login • CH-Quantum</title>
<style>:root{--bg:#0b0f14;--fg:#e7edf3;--card:#121a23;--line:#213041;--acc:#ff7a18}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px system-ui}
.wrap{min-height:100svh;display:grid;place-items:center;padding:24px}
.card{max-width:420px;width:100%;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:20px}
h1{margin:.2rem 0 1rem}label{display:block;margin:.5rem 0 .3rem}
input{width:100%;padding:12px;border-radius:12px;border:1px solid var(--line);background:#0e1620;color:var(--fg)}
.btn{width:100%;margin-top:14px;padding:12px;border-radius:12px;border:none;font-weight:800;background:var(--acc);color:#111}
.err{margin-top:10px;padding:10px;border-radius:10px;background:#2a0f12;border:1px solid #5a1c21;color:#ffb2b2}</style>
<div class=wrap><form class=card method=POST action=/auth>
<h1>CH-Quantum • WayPro</h1>
<p>Panel prywatny. Użyj <em>Access Token</em>.</p>
${err}
<label>Access Token</label><input name=token type=password autofocus>
<label style="display:flex;gap:.6rem;align-items:center;margin-top:.6rem"><input type=checkbox name=remember checked>Pamiętaj mnie</label>
<button class=btn>Wejdź</button><div style="margin-top:8px;opacity:.7">v${V}</div></form></div>`;
}
function pretty404HTML(path="/"){
  return `<!doctype html><meta charset=utf-8><title>404</title>
<style>body{margin:0;background:#0b0f14;color:#e7edf3;font:16px system-ui} .w{min-height:100svh;display:grid;place-items:center}
.c{padding:24px;border:1px solid #213041;background:#121a23;border-radius:16px;max-width:560px}</style>
<div class=w><div class=c><h1>404 — ${path}</h1><p><a href="/" style="color:#ff7a18">Wróć do Dashboardu</a></p></div></div>`;
}
async function serveFile(pathname){
  const safe = pathname.replace(/\/+/g,"/").replace(/\.\./g,""); const file = safe === "/" ? "/index.html" : safe;
  try{ const url=new URL(`.${file}`, import.meta.url); const ext=file.match(/\.[^.]+$/)?.[0].toLowerCase()||".txt";
    const mime=MIME[ext]||"application/octet-stream"; const res=await fetch(url); if(!res.ok) return null;
    const h=new Headers(res.headers); h.set("content-type", mime); if (ext===".css"||ext===".js") h.set("cache-control","public,max-age=3600");
    Object.entries(sec()).forEach(([k,v])=>h.set(k,v)); return new Response(res.body, { status:200, headers:h });
  }catch{ return null; }
}

/* ---------- runtime flags (overrides) ---------- */
async function getOverrides(){ return (await kv.get(["cfg","auto_overrides"])).value || {}; }
async function setOverrides(patch){
  const current = await getOverrides();
  const next = { ...current, ...patch };
  await kv.set(["cfg","auto_overrides"], next);
  return next;
}
async function getAutoFlags(){
  const ov = await getOverrides();
  return {
    email: ov.auto_email ?? AUTO_EMAIL_RECEIPT_ENV,
    license: ov.auto_license ?? AUTO_LICENSE_ENV,
    forward: ov.forward ?? (!!OUTBOUND_WEBHOOK_URL && !!OUTBOUND_WEBHOOK_SECRET)
  };
}

/* ---------- Stripe ---------- */
async function stripeReq(path, {method="POST", form, idempotencyKey}={}){
  if (!STRIPE_SECRET) throw new Error("Stripe secret missing");
  const headers = { "authorization":`Bearer ${STRIPE_SECRET}` };
  if (method==="POST"){ headers["content-type"]="application/x-www-form-urlencoded"; }
  if (idempotencyKey) headers["idempotency-key"]=idempotencyKey;
  const url=`https://api.stripe.com/v1/${path}`;
  const r = await fetch(url, { method, headers, body: method==="POST" ? (typeof form==="string"?form:qs(form)) : undefined });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error?.message || `Stripe ${path} error`);
  return j;
}
const stripePOST = (path, form, key) => stripeReq(path, {method:"POST", form, idempotencyKey:key});
const stripeGET  = (path, params={}) => stripeReq(`${path}${Object.keys(params).length?`?${qs(params).toString()}`:""}`, {method:"GET"});

async function createCheckout({mode, priceId, quantity=1, success_url, cancel_url, customer_email}){
  const idem = crypto.randomUUID();
  const body = {
    mode, success_url, cancel_url,
    "allow_promotion_codes":"true", "automatic_tax[enabled]":"true",
    "billing_address_collection":"auto", "phone_number_collection[enabled]":"true",
    "customer_update[address]":"auto",
    "line_items[0][price]": priceId, "line_items[0][quantity]": String(quantity),
  };
  if (customer_email) body["customer_email"] = customer_email;
  return stripePOST("checkout/sessions", body, idem);
}
async function createSetup({customer_email, success_url, cancel_url}){
  const idem = crypto.randomUUID();
  const body = { "payment_method_types[]":"card", mode:"setup", success_url, cancel_url,
    "billing_address_collection":"auto","phone_number_collection[enabled]":"true","automatic_tax[enabled]":"true" };
  if (customer_email) body["customer_email"]=customer_email;
  return stripePOST("checkout/sessions", body, idem);
}
async function verifyStripeSignature(raw, sigHeader, secret) {
  const parts = Object.fromEntries(sigHeader.split(",").map(kv=>kv.split("=").map(s=>s.trim())).filter(a=>a.length===2));
  const t = parts["t"]; const v1 = parts["v1"]; if (!t || !v1) return false;
  const data = `${t}.${raw}`; const digest = await hmacHex(secret, data);
  if (digest.length !== v1.length) return false; let ok = 0; for (let i=0;i<digest.length;i++) ok |= (digest.charCodeAt(i) ^ v1.charCodeAt(i)); return ok === 0;
}

/* ---------- Resend ---------- */
async function sendEmail({to, subject, html}) {
  if (!RESEND_API_KEY) throw new Error("Resend API key missing");
  const r = await fetch("https://api.resend.com/emails", {
    method:"POST", headers:{ "authorization": `Bearer ${RESEND_API_KEY}`, "content-type":"application/json" },
    body: JSON.stringify({ from: RESEND_FROM, to: to.split(",").map(s=>s.trim()).filter(Boolean), subject, html })
  });
  const j = await r.json(); if (!r.ok) throw new Error(j?.message || "Resend error"); return j;
}

/* ---------- External forward (ERP/CRM) ---------- */
async function forwardEvent(type, payload){
  const flags = await getAutoFlags();
  if (!flags.forward) return;
  const url = OUTBOUND_WEBHOOK_URL; const secret = OUTBOUND_WEBHOOK_SECRET;
  if (!url || !secret) return;
  const body = JSON.stringify({ type, payload, ts: Date.now(), version: V });
  const sig = await hmacHex(secret, body);
  await fetch(url, { method:"POST", headers:{ "content-type":"application/json", "x-qd-signature": sig }, body })
    .catch(()=>{});
}

/* ---------- Invoices numbering ---------- */
function yearPart(){ return INVOICE_YEAR_IN_PREFIX ? (new Date().getFullYear()+"-") : ""; }
async function nextInvoiceNumber(){
  const key=["cfg","invoice_seq", new Date().getFullYear()];
  const cur = (await kv.get(key)).value || 0; const nxt = cur + 1;
  await kv.set(key, nxt);
  return `${INVOICE_PREFIX}${yearPart()}${String(nxt).padStart(INVOICE_PADDING,"0")}`;
}

/* ---------- CI/CD ---------- */
async function triggerWorkflowDispatch({ref="main", inputs={}}){
  if (!GITHUB_REPO || !GITHUB_WORKFLOW_FILE || !GITHUB_TOKEN_PAT) throw new Error("Missing GH CI secrets");
  const r = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/${encodeURIComponent(GITHUB_WORKFLOW_FILE)}/dispatches`, {
    method:"POST", headers:{ "authorization": `Bearer ${GITHUB_TOKEN_PAT}`, "accept":"application/vnd.github+json" },
    body: JSON.stringify({ ref, inputs })
  });
  if (!r.ok) throw new Error(`GitHub dispatch failed (${r.status})`);
  return true;
}

/* ---------- server ---------- */
Deno.serve(async (req) => {
  const u = new URL(req.url);
  if (req.method==="OPTIONS") return new Response(null,{status:204,headers:sec()});

  // Public
  if (u.pathname==="/healthz"){
    const flags = await getAutoFlags();
    const lastCron = (await kv.get(["cron","last"])).value || null;
    return json({ok:true,ts:Date.now(),version:V,flags,lastCron});
  }
  if (u.pathname==="/version") return json({ok:true,version:V});
  if (u.pathname==="/robots.txt") return new Response("User-agent: *\nDisallow: /",{headers:{"content-type":"text/plain; charset=utf-8",...sec()}});
  if (u.pathname==="/logout") return new Response(null,{status:302,headers:{...sec(),"set-cookie":cookieClrHeader(),"location":"/auth"}});

  // Gate
  if ( !(isPublic(u) || !ACCESS_TOKEN) ) {
    if (!hasCookie(req)) {
      const incoming = extractIncomingToken(req,u);
      if (incoming && incoming===ACCESS_TOKEN){
        const headers={...sec(),"set-cookie":cookieSetHeader(COOKIE_DAYS)};
        if (u.searchParams.has("token")){ u.searchParams.delete("token"); headers["location"]=u.toString(); return new Response(null,{status:302,headers}); }
        return new Response(null,{status:204,headers});
      }
      if (u.pathname==="/auth" && req.method==="POST"){
        const form=await req.formData().catch(()=>null);
        const tok=form?.get("token")?.toString().trim()||"";
        if (tok===ACCESS_TOKEN) return new Response(null,{status:302,headers:{...sec(),"set-cookie":cookieSetHeader(COOKIE_DAYS),"location":"/"}});
        return new Response(loginHTML({error:"Nieprawidłowy token."}),{status:401,headers:{"content-type":"text/html; charset=utf-8",...sec()}});
      }
      if (u.pathname==="/auth" || u.pathname==="/") return new Response(loginHTML(),{status:401,headers:{"content-type":"text/html; charset=utf-8",...sec()}});
      return new Response(null,{status:302,headers:{...sec(),"location":"/auth"}});
    }
  }

  // ====== API: Stripe catalog ======
  if (u.pathname==="/api/stripe/products" && req.method==="GET"){
    try{ return json({ok:true, products: await stripeGET("products",{limit:100,active:true})}); }catch(e){ return json({ok:false,error:String(e.message||e)},500); }
  }
  if (u.pathname==="/api/stripe/prices" && req.method==="GET"){
    try{ return json({ok:true, prices: await stripeGET("prices",{limit:100,active:true,expand:["data.product"]})}); }catch(e){ return json({ok:false,error:String(e.message||e)},500); }
  }

  // ====== API: checkout/portal/setup ======
  if (u.pathname==="/api/checkout/payment" && req.method==="POST"){
    try{
      const { priceId=STRIPE_PRICE_ONETIME, quantity=1, success=`${u.origin}/?pay=success`, cancel=`${u.origin}/?pay=cancel`, email } = await req.json();
      if (!priceId) return json({ok:false,error:"Missing priceId"},400);
      const s = await createCheckout({mode:"payment", priceId, quantity, success_url:success, cancel_url:cancel, customer_email:email});
      await kv.set(["stripe","session", s.id], { id:s.id, url:s.url, status:"pending", mode:"payment", created:Date.now() });
      return json({ok:true, url:s.url, id:s.id});
    }catch(e){ return json({ok:false,error:String(e.message||e)},500); }
  }
  if (u.pathname==="/api/checkout/subscription" && req.method==="POST"){
    try{
      const { priceId=STRIPE_PRICE_SUB, quantity=1, success=`${u.origin}/?sub=success`, cancel=`${u.origin}/?sub=cancel`, email } = await req.json();
      if (!priceId) return json({ok:false,error:"Missing priceId"},400);
      const s = await createCheckout({mode:"subscription", priceId, quantity, success_url:success, cancel_url:cancel, customer_email:email});
      await kv.set(["stripe","session", s.id], { id:s.id, url:s.url, status:"pending", mode:"subscription", created:Date.now() });
      return json({ok:true, url:s.url, id:s.id});
    }catch(e){ return json({ok:false,error:String(e.message||e)},500); }
  }
  if (u.pathname==="/api/checkout/setup" && req.method==="POST"){
    try{
      const { email, success=`${u.origin}/?setup=success`, cancel=`${u.origin}/?setup=cancel` } = await req.json();
      const s = await createSetup({customer_email:email, success_url:success, cancel_url:cancel});
      await kv.set(["stripe","setup", s.id], { id:s.id, url:s.url, status:"pending", created:Date.now(), email:email||null });
      return json({ok:true, url:s.url, id:s.id});
    }catch(e){ return json({ok:false,error:String(e.message||e)},500); }
  }
  if (u.pathname==="/api/stripe/portal" && req.method==="POST"){
    try{
      if (!STRIPE_BILLING_PORTAL) return json({ok:false,error:"Portal disabled"},403);
      const { customer, return_url=`${u.origin}/` } = await req.json();
      if (!customer) return json({ok:false,error:"Missing customer id"},400);
      const sess = await stripePOST("billing_portal/sessions", { customer, return_url });
      return json({ok:true, url:sess.url});
    }catch(e){ return json({ok:false,error:String(e.message||e)},500); }
  }

  // ====== API: Invoice PDF / custom number ======
  if (u.pathname==="/api/invoice/pdf" && req.method==="GET"){
    try{
      const id = u.searchParams.get("id"); if (!id) return json({ok:false,error:"Missing invoice id"},400);
      const inv = await stripeGET(`invoices/${encodeURIComponent(id)}`); const pdfUrl = inv?.invoice_pdf;
      if (!pdfUrl) return json({ok:false,error:"No invoice_pdf URL"},404);
      const r = await fetch(pdfUrl); if (!r.ok) return json({ok:false,error:"Cannot fetch PDF"},502);
      const h = new Headers(r.headers); h.set("content-type","application/pdf"); Object.entries(sec()).forEach(([k,v])=>h.set(k,v));
      return new Response(r.body, {status:200, headers:h});
    }catch(e){ return json({ok:false,error:String(e.message||e)},500); }
  }
  if (u.pathname==="/api/invoice/custom" && req.method==="POST"){
    try{
      const { stripe_invoice_id } = await req.json();
      if (!stripe_invoice_id) return json({ok:false,error:"stripe_invoice_id required"},400);
      const existing = (await kv.get(["invoice_map", stripe_invoice_id])).value;
      if (existing) return json({ok:true, invoice: existing});
      const nr = await nextInvoiceNumber();
      const inv = await stripeGET(`invoices/${encodeURIComponent(stripe_invoice_id)}`);
      const data = { number: nr, stripe_id: stripe_invoice_id, total: inv.total, currency: inv.currency, customer: inv.customer, ts: Date.now(), invoice_pdf: inv.invoice_pdf || null };
      await kv.set(["invoice_map", stripe_invoice_id], data);
      return json({ok:true, invoice: data});
    }catch(e){ return json({ok:false,error:String(e.message||e)},500); }
  }

  // ====== API: Emails (manual), Licenses list ======
  if (u.pathname==="/api/email/send" && req.method==="POST"){
    try{
      const {to, subject, html} = await req.json();
      if (!to || !subject || !html) return json({ok:false,error:"to/subject/html required"},400);
      const r = await sendEmail({to, subject, html});
      await kv.set(["emails", r.id || crypto.randomUUID()], {to, subject, ts:Date.now()});
      return json({ok:true, id:r.id || null});
    }catch(e){ return json({ok:false,error:String(e.message||e)},500); }
  }
  if (u.pathname==="/api/licenses" && req.method==="GET"){
    const email = u.searchParams.get("email");
    const out = []; for await (const {value} of kv.list({ prefix: ["licenses"] })){ if (!email || value.email===email) out.push(value); }
    out.sort((a,b)=>(b.ts||0)-(a.ts||0));
    return json({ok:true, licenses: out});
  }

  // ====== Webhook Stripe ======
  if (u.pathname==="/webhooks/stripe" && req.method==="POST"){
    try{
      const raw = await req.text();
      if (STRIPE_WEBHOOK_SECRET){
        const sig = req.headers.get("stripe-signature") || "";
        const ok = await verifyStripeSignature(raw, sig, STRIPE_WEBHOOK_SECRET);
        if (!ok) return json({ok:false,error:"Invalid signature"},400);
      }
      const event = JSON.parse(raw || "{}");
      const flags = await getAutoFlags();

      switch(event.type){
        case "checkout.session.completed": {
          const s = event.data?.object || {};
          const record = {
            id: s.id, mode: s.mode, status: "completed",
            amount_total: s.amount_total, currency: s.currency,
            customer: s.customer, customer_email: s.customer_details?.email || s.customer_email || null,
            created: Date.now()
          };
          await kv.set(["orders", s.id], record);

          if (flags.license){
            const license = genLicenseKey();
            await kv.set(["licenses", s.id], { id:s.id, email:record.customer_email||null, license, ts:Date.now() });
            if (flags.email && RESEND_API_KEY && record.customer_email){
              const html = `<h1>Dziękujemy!</h1>
                <p>Twoje zamówienie (${record.id}) zostało opłacone.</p>
                <p><b>Klucz licencyjny:</b> <code style="font-size:18px">${license}</code></p>
                <p>Waluta: ${record.currency?.toUpperCase()||"-"}, kwota: ${(record.amount_total||0)/100}</p>`;
              await sendEmail({to:record.customer_email, subject:"Potwierdzenie i klucz licencyjny", html}).catch(()=>{});
            }
          } else if (flags.email && RESEND_API_KEY && record.customer_email){
            const html = `<h1>Dziękujemy!</h1><p>Twoje zamówienie (${record.id}) zostało opłacone.</p>`;
            await sendEmail({to:record.customer_email, subject:"Potwierdzenie zakupu", html}).catch(()=>{});
          }
          await forwardEvent(event.type, record);
          break;
        }
        case "invoice.payment_succeeded": {
          const inv = event.data?.object || {};
          await kv.set(["invoices", inv.id], { id: inv.id, customer: inv.customer, paid:true, total: inv.total, currency: inv.currency, ts: Date.now() });
          const map = (await kv.get(["invoice_map", inv.id])).value; if (!map){
            const nr = await nextInvoiceNumber();
            await kv.set(["invoice_map", inv.id], { number:nr, stripe_id:inv.id, total:inv.total, currency:inv.currency, customer:inv.customer, ts:Date.now(), invoice_pdf:inv.invoice_pdf || null });
          }
          await forwardEvent(event.type, { id: inv.id, customer: inv.customer, total: inv.total, currency: inv.currency });
          break;
        }
        case "invoice.payment_failed": {
          const inv = event.data?.object || {};
          await kv.set(["invoices", inv.id], { id: inv.id, customer: inv.customer, paid:false, total: inv.total, currency: inv.currency, ts: Date.now(), failed:true });
          await forwardEvent(event.type, { id: inv.id, customer: inv.customer, total: inv.total, currency: inv.currency });
          break;
        }
        case "charge.refunded": {
          const ch = event.data?.object || {};
          await kv.set(["refunds", ch.id], { id: ch.id, amount_refunded: ch.amount_refunded, ts: Date.now(), currency: ch.currency });
          await forwardEvent(event.type, { id: ch.id, amount_refunded: ch.amount_refunded, currency: ch.currency });
          break;
        }
        case "customer.subscription.created":
        case "customer.subscription.updated":
        case "customer.subscription.deleted": {
          const sub = event.data?.object || {};
          await kv.set(["subs", sub.id], { id: sub.id, status: sub.status, customer: sub.customer, ts: Date.now() });
          await forwardEvent(event.type, { id: sub.id, status: sub.status, customer: sub.customer });
          break;
        }
        default: {
          await kv.set(["stripe","event", event.id || crypto.randomUUID()], {type:event.type, ts:Date.now()});
          await forwardEvent(event.type, event.data?.object || {});
        }
      }
      return json({ok:true});
    }catch(e){ return json({ok:false,error:String(e.message||e)},500); }
  }

  // ====== Scheduler ======
  if (u.pathname==="/tasks/run" && req.method==="POST"){
    try{
      const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i,"").trim() || (await req.json().catch(()=>({token:null}))).token;
      if (!TASK_TOKEN || token!==TASK_TOKEN) return json({ok:false,error:"unauthorized"},401);
      const stats = { now: Date.now(), version: V };
      await kv.set(["cron","last"], stats);
      return json({ok:true, stats});
    }catch(e){ return json({ok:false,error:String(e.message||e)},500); }
  }

  // ====== ADMIN: Automation, Listing, Tests, Trigger cron ======
  if (u.pathname==="/api/admin/automation" && req.method==="GET"){
    try{
      const flags = await getAutoFlags();
      const env = { email: AUTO_EMAIL_RECEIPT_ENV, license: AUTO_LICENSE_ENV, forward: (!!OUTBOUND_WEBHOOK_URL && !!OUTBOUND_WEBHOOK_SECRET) };
      const overrides = await getOverrides();
      const lastCron = (await kv.get(["cron","last"])).value || null;
      // zliczenia
      const count = async (prefix)=>{ let n=0; for await (const _ of kv.list({prefix})) n++; return n; };
      const [orders, invoices, subs, emails, licenses, events] = await Promise.all([
        count(["orders"]), count(["invoices"]), count(["subs"]), count(["emails"]), count(["licenses"]), count(["stripe","event"])
      ]);
      return json({ok:true, version: V, env, overrides, flags, lastCron, counts:{orders,invoices,subs,emails,licenses,events}});
    }catch(e){ return json({ok:false,error:String(e.message||e)},500); }
  }
  if (u.pathname==="/api/admin/automation" && req.method==="POST"){
    try{
      const body = await req.json().catch(()=> ({}));
      const patch = {};
      if (typeof body.auto_email === "boolean") patch.auto_email = body.auto_email;
      if (typeof body.auto_license === "boolean") patch.auto_license = body.auto_license;
      if (typeof body.forward === "boolean") patch.forward = body.forward;
      const next = await setOverrides(patch);
      return json({ok:true, overrides: next, flags: await getAutoFlags()});
    }catch(e){ return json({ok:false,error:String(e.message||e)},500); }
  }

  if (u.pathname==="/api/admin/list" && req.method==="GET"){
    try{
      const type = u.searchParams.get("type")||"orders";
      const limit = Math.max(1, Math.min(200, parseInt(u.searchParams.get("limit")||"50",10)));
      const prefixMap = {
        orders:["orders"], invoices:["invoices"], subs:["subs"], emails:["emails"], licenses:["licenses"], events:["stripe","event"]
      };
      const prefix = prefixMap[type]; if (!prefix) return json({ok:false,error:"bad type"},400);
      const items=[]; for await (const {value} of kv.list({ prefix })) items.push(value);
      items.sort((a,b)=>(b.ts||0)-(a.ts||0));
      return json({ok:true, type, items: items.slice(0,limit)});
    }catch(e){ return json({ok:false,error:String(e.message||e)},500); }
  }

  if (u.pathname==="/api/admin/test/email" && req.method==="POST"){
    try{
      const {to} = await req.json().catch(()=>({}));
      if (!to) return json({ok:false,error:"to required"},400);
      const r = await sendEmail({to, subject:"Test • CH-Quantum", html:"<h1>OK</h1><p>To jest test.</p>"});
      await kv.set(["emails", r.id || crypto.randomUUID()], {to, subject:"Test", ts:Date.now()});
      return json({ok:true, id:r.id || null});
    }catch(e){ return json({ok:false,error:String(e.message||e)},500); }
  }

  if (u.pathname==="/api/admin/test/forward" && req.method==="POST"){
    try{
      const flags = await getAutoFlags();
      if (!flags.forward) return json({ok:false,error:"forward disabled"},400);
      const payload = { ping:true, at: Date.now() };
      await forwardEvent("qd.test.forward", payload);
      return json({ok:true});
    }catch(e){ return json({ok:false,error:String(e.message||e)},500); }
  }

  if (u.pathname==="/api/admin/trigger/cron" && req.method==="POST"){
    try{
      if (!TASK_TOKEN) return json({ok:false,error:"TASK_TOKEN not set"},400);
      const r = await fetch(new URL("/tasks/run", u.origin), { method:"POST", headers:{ "authorization": `Bearer ${TASK_TOKEN}`, "content-type":"application/json" }, body: JSON.stringify({reason:"manual"}) });
      const j = await r.json();
      return json({ok:true, result:j});
    }catch(e){ return json({ok:false,error:String(e.message||e)},500); }
  }

  // Statics
  const asset = await serveFile(u.pathname);
  if (asset) return asset;

  return new Response(pretty404HTML(u.pathname),{status:404,headers:{"content-type":"text/html; charset=utf-8",...sec()}});
});

/* ---------- helpers ---------- */
function genLicenseKey(len=29){
  const alphabet="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s=""; for(let i=0;i<25;i++){ s+=alphabet[Math.floor(Math.random()*alphabet.length)]; }
  return s.replace(/(.{5})/g,"$1-").slice(0,len);
}
