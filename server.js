// server.js — LeonCloudQ / Quantum Dashboard PRO v6.6.0
import { serveFile } from "https://deno.land/std@0.224.0/http/file_server.ts";

const VERSION = "6.6.0";

// ENV
const QDP_TOKEN  = Deno.env.get("QDP_TOKEN") ?? "";
const COOKIE_DAYS= parseInt(Deno.env.get("QDP_COOKIE_DAYS") ?? "30", 10);

const AI_PROVIDER    = (Deno.env.get("QDP_AI_PROVIDER") ?? "").toLowerCase();
const AI_MODEL       = Deno.env.get("QDP_AI_MODEL") ?? "";
const OPENAI_KEY     = Deno.env.get("OPENAI_API_KEY") ?? "";
const OPENROUTER_KEY = Deno.env.get("OPENROUTER_API_KEY") ?? "";
const IMG_PROVIDER   = (Deno.env.get("QDP_IMAGE_PROVIDER") ?? "openai").toLowerCase();
const IMG_MODEL      = Deno.env.get("QDP_IMAGE_MODEL") ?? "dall-e-3";

const OLLAMA_URL     = Deno.env.get("OLLAMA_URL") ?? "http://127.0.0.1:11434";

const kv = await (async()=>{ try{ return await Deno.openKv(); } catch{ return null; } })();

// Helpers
const RATE_LIMIT_WINDOW_MS=60_000, RATE_LIMIT_MAX=120; const rate=new Map();
const toB64 = (buf)=>btoa(String.fromCharCode(...new Uint8Array(buf)));
const fromB64=(b64)=>Uint8Array.from(atob(b64),c=>c.charCodeAt(0));
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const timeout=(ms)=>new Promise((_,rej)=>setTimeout(()=>rej(new Error("timeout")),ms));

function json(data,init={}){ return new Response(JSON.stringify(data),{ headers:{ "content-type":"application/json; charset=utf-8" },...init }); }
function notFound(){ return new Response("Not Found",{status:404}); }
function hasAuth(req){ const c=req.headers.get("cookie")??""; return !!QDP_TOKEN && c.includes("qdp="); }
function setCookie(h,name,val,days){ const exp=new Date(Date.now()+days*864e5).toUTCString(); h.append("set-cookie",`${name}=${val}; Path=/; HttpOnly; SameSite=Lax; Secure; Expires=${exp}`); }
function ipOf(req){ const xf=req.headers.get("x-forwarded-for"); if(xf) return xf.split(",")[0].trim(); try{ return (new URL(req.url)).hostname||"local"; }catch{ return "local"; } }
function checkRate(req){ const ip=ipOf(req), now=Date.now(); let slot=rate.get(ip); if(!slot||now>slot.reset){ slot={count:0,reset:now+RATE_LIMIT_WINDOW_MS}; rate.set(ip,slot);} slot.count++; return slot.count<=RATE_LIMIT_MAX; }

function secHeaders(origin){
  const csp = [
    "default-src 'self'",
    "img-src 'self' data: blob:",
    "media-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self' 'unsafe-inline'",
    `connect-src 'self' https://api.openai.com https://openrouter.ai ${OLLAMA_URL}`
  ].join("; ");
  return {
    "content-security-policy": csp,
    "strict-transport-security":"max-age=31536000; includeSubDomains; preload",
    "x-frame-options":"DENY","x-content-type-options":"nosniff",
    "referrer-policy":"strict-origin-when-cross-origin",
    "cross-origin-opener-policy":"same-origin",
    "cross-origin-resource-policy":"same-origin",
    "permissions-policy":"geolocation=(), microphone=(), camera=()",
    "access-control-allow-origin": origin,
    "access-control-allow-headers":"content-type,x-qdp-secret",
    "access-control-allow-methods":"GET,POST,DELETE,OPTIONS",
    "access-control-max-age":"600"
  };
}

// Static
async function serveStatic(req){
  const url=new URL(req.url); const p=decodeURIComponent(url.pathname);
  const white=new Set(["/","/index.html","/manifest.webmanifest","/sw.js","/logo-192.png","/logo-512.png","/logo-maskable.png","/favicon.ico","/robots.txt","/sitemap.xml","/notify.mp3","/success.mp3","/error.mp3"]);
  if(white.has(p)){ const f=p==="/" ? "/index.html":p; try{ return await serveFile(req,`.${f}`);}catch{} }
  if(p.includes(".")){ try{ return await serveFile(req,`.${p}`);}catch{} }
  try{ const res=await serveFile(req,"./index.html"); const h=new Headers(res.headers); h.set("cache-control","no-store"); return new Response(res.body,{status:200,headers:h}); }
  catch{ return notFound(); }
}

// KV tiny helpers
async function kvGet(key){ if(!kv) return null; const r=await kv.get(key); return r.value ?? null; }
async function kvSet(key,val){ if(!kv) return false; await kv.set(key,val); return true; }

// UI password in KV: ["qdp","ui-pass"] {saltB64, hashB64}
async function newSaltB64(){ const s=new Uint8Array(16); crypto.getRandomValues(s); return toB64(s); }
async function hashPass(saltB64,pass){
  const salt=fromB64(saltB64); const enc=new TextEncoder().encode(pass);
  const buf=new Uint8Array(salt.length+enc.length); buf.set(salt,0); buf.set(enc,salt.length);
  const digest=await crypto.subtle.digest("SHA-256",buf); return toB64(digest);
}
async function uiPassStatus(){ const rec=await kvGet(["qdp","ui-pass"]); return { set: !!(rec&&rec.saltB64&&rec.hashB64) }; }
async function uiPassVerify(pass){ const rec=await kvGet(["qdp","ui-pass"]); if(!rec) return false; const h=await hashPass(rec.saltB64,pass); return h===rec.hashB64; }
async function uiPassSet({oldPass,newPass}){
  const rec=await kvGet(["qdp","ui-pass"]);
  if(rec){ const ok=await uiPassVerify(oldPass||""); if(!ok) return {ok:false,err:"bad-old-pass"}; }
  const saltB64=await newSaltB64(); const hashB64=await hashPass(saltB64,newPass);
  await kvSet(["qdp","ui-pass"],{saltB64,hashB64,ts:Date.now()}); return {ok:true};
}

// Assist actions
const Actions = {
  "projects.verifyHead": async ({url})=>{ try{ const r=await fetch(url,{method:"HEAD"}); return {ok:r.ok,status:r.status,headers:Object.fromEntries(r.headers)}; }catch(e){ return {ok:false,err:String(e)}; } },
  "deploy.webhook": async ({url,secret})=>{ try{ const r=await fetch(url,{method:"POST",headers:{"content-type":"application/json","x-qdp-secret":secret||""},body:JSON.stringify({ts:Date.now(),source:"qdp"})}); return {ok:r.ok,status:r.status,body:await r.text()}; }catch(e){ return {ok:false,err:String(e)}; } },
  "kv.put": async ({key,value})=>{ if(!kv) return {ok:false,err:"kv-disabled"}; await kv.set(["qdp",key],value); return {ok:true}; },
  "kv.get": async ({key})=>{ if(!kv) return {ok:false,err:"kv-disabled"}; const r=await kv.get(["qdp",key]); return {ok:true,value:r.value??null}; }
};

// AI chat
async function aiChatRouter({provider,model,messages,temperature=0.2}){
  provider=(provider||AI_PROVIDER||"openai").toLowerCase();
  model=model||AI_MODEL||"gpt-4o-mini";

  if(provider==="openai"){
    if(!OPENAI_KEY) return {ok:false,err:"missing OPENAI_API_KEY"};
    const r=await Promise.race([
      fetch("https://api.openai.com/v1/chat/completions",{method:"POST",headers:{"content-type":"application/json","authorization":`Bearer ${OPENAI_KEY}`},body:JSON.stringify({model,temperature,messages})}),
      timeout(30_000)
    ]);
    if(!r.ok) return {ok:false,err:`openai ${r.status}`,detail:await r.text()};
    const j=await r.json(); const text=j?.choices?.[0]?.message?.content??"";
    return {ok:true,provider:"openai",model,text,raw:j};
  }

  if(provider==="openrouter"){
    if(!OPENROUTER_KEY) return {ok:false,err:"missing OPENROUTER_API_KEY"};
    const m=model||"anthropic/claude-3.5-sonnet";
    const r=await Promise.race([
      fetch("https://openrouter.ai/api/v1/chat/completions",{method:"POST",headers:{"content-type":"application/json","authorization":`Bearer ${OPENROUTER_KEY}`,"x-title":"LeonCloudQ"},body:JSON.stringify({model:m,temperature,messages})}),
      timeout(30_000)
    ]);
    if(!r.ok) return {ok:false,err:`openrouter ${r.status}`,detail:await r.text()};
    const j=await r.json(); const text=j?.choices?.[0]?.message?.content??"";
    return {ok:true,provider:"openrouter",model:m,text,raw:j};
  }

  // opcjonalnie lokalny Ollama (jeśli ustawisz)
  if(provider==="ollama"){
    const m=model||"llama3.1";
    const r=await Promise.race([
      fetch(`${OLLAMA_URL}/v1/chat/completions`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({model:m,messages,temperature})}),
      timeout(30_000)
    ]);
    if(!r.ok) return {ok:false,err:`ollama ${r.status}`,detail:await r.text()};
    const j=await r.json(); const text=j?.choices?.[0]?.message?.content??"";
    return {ok:true,provider:"ollama",model:m,text,raw:j};
  }

  return {ok:false,err:"unknown-provider",hint:"use openai/openrouter/ollama"};
}

// Images (OpenAI)
async function genImagesOpenAI({prompt,model="dall-e-3",size="1024x1024",n=1}){
  if(!OPENAI_KEY) return {ok:false,err:"missing OPENAI_API_KEY"};
  n=Math.min(Math.max(parseInt(n||1,10),1),4);
  const r=await Promise.race([
    fetch("https://api.openai.com/v1/images/generations",{method:"POST",headers:{"content-type":"application/json","authorization":`Bearer ${OPENAI_KEY}`},body:JSON.stringify({model,prompt,n,size,response_format:"b64_json"})}),
    timeout(60_000)
  ]);
  if(!r.ok) return {ok:false,err:`openai ${r.status}`,detail:await r.text()};
  const j=await r.json();
  return {ok:true,provider:"openai",model,images:(j.data||[]).map(x=>({b64:x.b64_json}))};
}

// API
async function handleApi(req){
  const url=new URL(req.url); const {pathname,searchParams}=url;
  if(req.method==="OPTIONS") return new Response(null,{status:204});
  if(pathname==="/ping") return json({ok:true,ts:Date.now()});
  if(pathname==="/version") return json({ok:true,version:VERSION,kv:!!kv,flags:{email:false,license:true,forward:false},ai:{provider:AI_PROVIDER||null,model:AI_MODEL||null},image:{provider:IMG_PROVIDER||"openai",model:IMG_MODEL||"dall-e-3"}});
  if(pathname==="/healthz"){ if(QDP_TOKEN && !hasAuth(req)) return json({ok:false,err:"unauthorized"},{status:401}); return json({ok:true,ts:Date.now()}); }

  if(searchParams.has("token")){
    const t=searchParams.get("token")??""; if(!QDP_TOKEN) return json({ok:false,err:"QDP_TOKEN not set in ENV"},{status:500});
    const h=new Headers({"content-type":"text/html; charset=utf-8"});
    if(t===QDP_TOKEN){ setCookie(h,"qdp","1",COOKIE_DAYS); const redir=new URL(req.url); redir.searchParams.delete("token"); return new Response(`<meta http-equiv="refresh" content="0;url='${redir.toString()}'" />`,{headers:h}); }
    return json({ok:false,err:"invalid token"},{status:401});
  }

  if(!checkRate(req)){ await sleep(150); return json({ok:false,err:"rate-limited"},{status:429}); }

  // UI pass
  if(pathname==="/api/ui-pass/status" && req.method==="GET"){ if(QDP_TOKEN && !hasAuth(req)) return json({ok:false,err:"unauthorized"},{status:401}); return json({ok:true, ...(await uiPassStatus())}); }
  if(pathname==="/api/ui-pass/verify" && req.method==="POST"){ if(QDP_TOKEN && !hasAuth(req)) return json({ok:false,err:"unauthorized"},{status:401}); const b=await req.json().catch(()=>({})); const ok=await uiPassVerify(String(b.pass||"")); return json({ok}); }
  if(pathname==="/api/ui-pass/set" && req.method==="POST"){ if(QDP_TOKEN && !hasAuth(req)) return json({ok:false,err:"unauthorized"},{status:401}); const b=await req.json().catch(()=>({})); const newPass=(b.new||"").toString(); if(!newPass||newPass.length<4) return json({ok:false,err:"weak-pass"},{status:400}); const out=await uiPassSet({oldPass:(b.old||"").toString(),newPass}); return json(out,{status:out.ok?200:400}); }

  // KV generic
  if(pathname.startsWith("/api/kv/") && kv){
    if(QDP_TOKEN && !hasAuth(req)) return json({ok:false,err:"unauthorized"},{status:401});
    const key=pathname.replace("/api/kv/",""); if(req.method==="GET"){ const r=await kv.get(["qdp",key]); return json({ok:true,value:r.value??null}); }
    if(req.method==="POST"){ const body=await req.json().catch(()=>({})); await kv.set(["qdp",key],body); return json({ok:true}); }
    if(req.method==="DELETE"){ await kv.delete(["qdp",key]); return json({ok:true}); }
  }

  // Assist
  if(pathname==="/api/assist/run" && req.method==="POST"){
    if(QDP_TOKEN && !hasAuth(req)) return json({ok:false,err:"unauthorized"},{status:401});
    const {action,params}=await req.json().catch(()=>({})); if(!action || !(action in Actions)) return json({ok:false,err:"unknown-action"},{status:400});
    const out=await Actions[action](params||{}); return json(out);
  }

  // AI chat
  if(pathname==="/api/ai/chat" && req.method==="POST"){
    if(QDP_TOKEN && !hasAuth(req)) return json({ok:false,err:"unauthorized"},{status:401});
    const body=await req.json().catch(()=>({})); const out=await aiChatRouter({provider:body.provider,model:body.model,messages:body.messages,temperature:body.temperature});
    return json(out,{status:out.ok?200:400});
  }

  // Images
  if(pathname==="/api/image/generate" && req.method==="POST"){
    if(QDP_TOKEN && !hasAuth(req)) return json({ok:false,err:"unauthorized"},{status:401});
    const body=await req.json().catch(()=>({}));
    const provider=(body.provider||IMG_PROVIDER||"openai").toLowerCase();
    const model=body.model||IMG_MODEL||"dall-e-3";
    const prompt=(body.prompt||"").toString();
    const size=(body.size||"1024x1024").toString();
    const n=parseInt(body.n||1,10);
    if(!prompt) return json({ok:false,err:"missing-prompt"},{status:400});
    if(provider!=="openai") return json({ok:false,err:"unsupported-provider"},{status:400});
    const out=await genImagesOpenAI({prompt,model,size,n});
    return json(out,{status:out.ok?200:400});
  }

  return null;
}

// HTTP
Deno.serve(async (req)=>{
  try{
    const api=await handleApi(req);
    const origin=new URL(req.url).origin;
    const sec=secHeaders(origin);

    if(api){ const h=new Headers(api.headers); for(const [k,v] of Object.entries(sec)) h.set(k,v); return new Response(api.body,{status:api.status,headers:h}); }
    const res=await serveStatic(req); const h=new Headers(res.headers); for(const [k,v] of Object.entries(sec)) h.set(k,v);
    if(new URL(req.url).pathname==="/") h.set("cache-control","no-store");
    return new Response(res.body,{status:res.status,headers:h});
  }catch(e){
    console.error("[SERVER ERROR]", e?.stack||e); return json({ok:false,err:"server-error"},{status:500});
  }
});
