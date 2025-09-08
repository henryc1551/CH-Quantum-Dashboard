// server.js — LeonCloudQ / Quantum Dashboard PRO v6.7.0
// Pełny backend: auth cookie (?token), KV, UI password, AI chat, DALL·E, YouTube/TikTok OAuth+API, GFX presets, statyki, security.

import { serveFile } from "https://deno.land/std@0.224.0/http/file_server.ts";

const VERSION = "6.7.0";

// === ENV AUTH/UI ===
const QDP_TOKEN       = Deno.env.get("QDP_TOKEN") ?? "";
const COOKIE_DAYS     = parseInt(Deno.env.get("QDP_COOKIE_DAYS") ?? "30", 10);

// === AI ===
const AI_PROVIDER     = (Deno.env.get("QDP_AI_PROVIDER") ?? "").toLowerCase();
const AI_MODEL        = Deno.env.get("QDP_AI_MODEL") ?? "";
const OPENAI_KEY      = Deno.env.get("OPENAI_API_KEY") ?? "";
const OPENROUTER_KEY  = Deno.env.get("OPENROUTER_API_KEY") ?? "";
const OLLAMA_URL      = Deno.env.get("OLLAMA_URL") ?? "http://127.0.0.1:11434";

// === IMAGES ===
const IMG_PROVIDER    = (Deno.env.get("QDP_IMAGE_PROVIDER") ?? "openai").toLowerCase();
const IMG_MODEL       = Deno.env.get("QDP_IMAGE_MODEL") ?? "dall-e-3";

// === OAUTH: YouTube ===
const YT_CLIENT_ID     = Deno.env.get("YOUTUBE_CLIENT_ID") ?? "";
const YT_CLIENT_SECRET = Deno.env.get("YOUTUBE_CLIENT_SECRET") ?? "";
const YT_REDIRECT_URI  = Deno.env.get("YOUTUBE_REDIRECT_URI") ?? "";

// === OAUTH: TikTok ===
const TTK_CLIENT_KEY    = Deno.env.get("TIKTOK_CLIENT_KEY") ?? "";
const TTK_CLIENT_SECRET = Deno.env.get("TIKTOK_CLIENT_SECRET") ?? "";
const TTK_REDIRECT_URI  = Deno.env.get("TIKTOK_REDIRECT_URI") ?? "";

// === KV ===
const kv = await (async()=>{ try{ return await Deno.openKv(); } catch{ return null; } })();

// === HELPERS ===
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
    `connect-src 'self' https://api.openai.com https://openrouter.ai ${OLLAMA_URL} https://accounts.google.com https://oauth2.googleapis.com https://www.googleapis.com https://www.tiktok.com https://open.tiktokapis.com`
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

// === STATIC ===
async function serveStatic(req){
  const url=new URL(req.url); const p=decodeURIComponent(url.pathname);
  const white=new Set([
    "/","/index.html","/manifest.webmanifest","/sw.js",
    "/logo-192.png","/logo-512.png","/logo-maskable.png","/favicon.ico",
    "/robots.txt","/sitemap.xml","/notify.mp3","/success.mp3","/error.mp3",
    "/gfx.js","/rt/PathTracerWebGPU.js"
  ]);
  if(white.has(p)){ const f=p==="/" ? "/index.html":p; try{ return await serveFile(req,`.${f}`);}catch{} }
  if(p.includes(".")){ try{ return await serveFile(req,`.${p}`);}catch{} }
  try{ const res=await serveFile(req,"./index.html"); const h=new Headers(res.headers); h.set("cache-control","no-store"); return new Response(res.body,{status:200,headers:h}); }
  catch{ return notFound(); }
}

// === KV UTIL ===
async function kvGet(key){ if(!kv) return null; const r=await kv.get(key); return r.value ?? null; }
async function kvSet(key,val){ if(!kv) return false; await kv.set(key,val); return true; }

// === UI PASSWORD (KV: ["qdp","ui-pass"] -> {saltB64,hashB64}) ===
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

// === ASSIST ACTIONS (mini) ===
const Actions = {
  "projects.verifyHead": async ({url})=>{ try{ const r=await fetch(url,{method:"HEAD"}); return {ok:r.ok,status:r.status,headers:Object.fromEntries(r.headers)}; }catch(e){ return {ok:false,err:String(e)}; } },
  "deploy.webhook":     async ({url,secret})=>{ try{ const r=await fetch(url,{method:"POST",headers:{"content-type":"application/json","x-qdp-secret":secret||""},body:JSON.stringify({ts:Date.now(),source:"qdp"})}); return {ok:r.ok,status:r.status,body:await r.text()}; }catch(e){ return {ok:false,err:String(e)}; } },
  "kv.put":             async ({key,value})=>{ if(!kv) return {ok:false,err:"kv-disabled"}; await kv.set(["qdp",key],value); return {ok:true}; },
  "kv.get":             async ({key})=>{ if(!kv) return {ok:false,err:"kv-disabled"}; const r=await kv.get(["qdp",key]); return {ok:true,value:r.value??null}; }
};

// === AI CHAT ROUTER ===
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

// === IMAGES (OpenAI) ===
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

// === YOUTUBE TOKENS ===
const KV_YT  = ["oauth","youtube"]; // { refresh_token, access_token?, exp? }
async function ytExchangeCode(code){
  const r=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({code,client_id:YT_CLIENT_ID,client_secret:YT_CLIENT_SECRET,redirect_uri:YT_REDIRECT_URI,grant_type:"authorization_code"})});
  if(!r.ok) throw new Error("yt token code "+r.status+" "+await r.text()); return await r.json();
}
async function ytRefresh(refresh_token){
  const r=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({refresh_token,client_id:YT_CLIENT_ID,client_secret:YT_CLIENT_SECRET,grant_type:"refresh_token"})});
  if(!r.ok) throw new Error("yt token refresh "+r.status+" "+await r.text()); return await r.json();
}
async function ytGetAccess(){
  const rec=await kvGet(KV_YT); if(!rec||!rec.refresh_token) throw new Error("YouTube not linked");
  const j=await ytRefresh(rec.refresh_token); const access_token=j.access_token; const exp=Date.now()+(j.expires_in||3600)*1000-30_000;
  await kvSet(KV_YT,{...rec,access_token,exp}); return access_token;
}

// === TIKTOK TOKENS ===
const KV_TTK = ["oauth","tiktok"]; // { access_token, refresh_token?, expires_in, scope }
async function ttkExchangeCode(code){
  const r=await fetch("https://open.tiktokapis.com/v2/oauth/token/",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_key:TTK_CLIENT_KEY,client_secret:TTK_CLIENT_SECRET,code,grant_type:"authorization_code",redirect_uri:TTK_REDIRECT_URI})});
  if(!r.ok) throw new Error("tiktok token code "+r.status+" "+await r.text()); return await r.json();
}
async function ttkRefresh(refresh_token){
  const r=await fetch("https://open.tiktokapis.com/v2/oauth/token/",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_key:TTK_CLIENT_KEY,client_secret:TTK_CLIENT_SECRET,grant_type:"refresh_token",refresh_token})});
  if(!r.ok) throw new Error("tiktok refresh "+r.status+" "+await r.text()); return await r.json();
}
async function ttkGetAccess(){
  const rec=await kvGet(KV_TTK); if(!rec||!rec.access_token) throw new Error("TikTok not linked");
  if(rec.refresh_token){ try{ const j=await ttkRefresh(rec.refresh_token); await kvSet(KV_TTK,{...rec,...j}); return j.access_token; }catch{ /* ignore */ } }
  return rec.access_token;
}

// === API ROUTER ===
async function handleApi(req){
  const url=new URL(req.url); const {pathname,searchParams}=url;
  if(req.method==="OPTIONS") return new Response(null,{status:204});

  if(pathname==="/ping")    return json({ok:true,ts:Date.now()});
  if(pathname==="/version") return json({ok:true,version:VERSION,kv:!!kv,flags:{email:false,license:true,forward:false},ai:{provider:AI_PROVIDER||null,model:AI_MODEL||null},image:{provider:IMG_PROVIDER||"openai",model:IMG_MODEL||"dall-e-3"}});
  if(pathname==="/healthz"){ if(QDP_TOKEN && !hasAuth(req)) return json({ok:false,err:"unauthorized"},{status:401}); return json({ok:true,ts:Date.now()}); }

  // token -> cookie
  if(searchParams.has("token")){
    const t=searchParams.get("token")??""; if(!QDP_TOKEN) return json({ok:false,err:"QDP_TOKEN not set in ENV"},{status:500});
    const h=new Headers({"content-type":"text/html; charset=utf-8"});
    if(t===QDP_TOKEN){ setCookie(h,"qdp","1",COOKIE_DAYS); const redir=new URL(req.url); redir.searchParams.delete("token"); return new Response(`<meta http-equiv="refresh" content="0;url='${redir.toString()}'" />`,{headers:h}); }
    return json({ok:false,err:"invalid token"},{status:401});
  }

  if(!checkRate(req)){ await sleep(150); return json({ok:false,err:"rate-limited"},{status:429}); }

  // UI PASS
  if(pathname==="/api/ui-pass/status" && req.method==="GET"){ if(QDP_TOKEN && !hasAuth(req)) return json({ok:false,err:"unauthorized"},{status:401}); return json({ok:true, ...(await uiPassStatus())}); }
  if(pathname==="/api/ui-pass/verify" && req.method==="POST"){ if(QDP_TOKEN && !hasAuth(req)) return json({ok:false,err:"unauthorized"},{status:401}); const b=await req.json().catch(()=>({})); const ok=await passSafeVerify(b); return json({ok}); }
  if(pathname==="/api/ui-pass/set"    && req.method==="POST"){ if(QDP_TOKEN && !hasAuth(req)) return json({ok:false,err:"unauthorized"},{status:401}); const b=await req.json().catch(()=>({})); const out=await passSafeSet(b); return json(out,{status:out.ok?200:400}); }
  async function passSafeVerify(b){ const pass=String(b.pass||""); return await uiPassVerify(pass); }
  async function passSafeSet(b){
    const newPass=(b.new||"").toString(); if(!newPass||newPass.length<4) return {ok:false,err:"weak-pass"};
    return await uiPassSet({oldPass:(b.old||"").toString(),newPass});
  }

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

  // OAuth: YouTube
  if(pathname==="/oauth/youtube/start" && req.method==="GET"){
    if(!YT_CLIENT_ID||!YT_REDIRECT_URI) return json({ok:false,err:"missing-yt-env"},{status:500});
    const scopes=["https://www.googleapis.com/auth/youtube.upload","https://www.googleapis.com/auth/youtube.readonly"].join(" ");
    const auth=new URL("https://accounts.google.com/o/oauth2/v2/auth");
    auth.searchParams.set("client_id",YT_CLIENT_ID);
    auth.searchParams.set("redirect_uri",YT_REDIRECT_URI);
    auth.searchParams.set("response_type","code");
    auth.searchParams.set("access_type","offline");
    auth.searchParams.set("prompt","consent");
    auth.searchParams.set("scope",scopes);
    return Response.redirect(auth.toString(),302);
  }
  if(pathname==="/oauth/youtube/callback" && req.method==="GET"){
    const code=new URL(req.url).searchParams.get("code"); if(!code) return json({ok:false,err:"missing-code"},{status:400});
    try{ const tok=await ytExchangeCode(code); await kvSet(KV_YT,{refresh_token:tok.refresh_token,ts:Date.now()});
      return new Response(`<html><body style="font-family:ui-sans-serif;background:#0b0b0c;color:#e7e7ec;"><h2>✅ YouTube połączony</h2><p>Możesz zamknąć to okno.</p></body></html>`,{headers:{"content-type":"text/html; charset=utf-8"}});
    }catch(e){ return json({ok:false,err:String(e)},{status:500}); }
  }
  if(pathname==="/api/youtube/me" && req.method==="GET"){
    if(QDP_TOKEN && !hasAuth(req)) return json({ok:false,err:"unauthorized"},{status:401});
    try{ const at=await ytGetAccess(); const r=await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",{headers:{"authorization":`Bearer ${at}`}}); const j=await r.json(); return json({ok:true,data:j}); }
    catch(e){ return json({ok:false,err:String(e)},{status:500}); }
  }
  if(pathname==="/api/youtube/uploadFromUrl" && req.method==="POST"){
    if(QDP_TOKEN && !hasAuth(req)) return json({ok:false,err:"unauthorized"},{status:401});
    const body=await req.json().catch(()=>({})); const {videoUrl,title,description,privacyStatus="unlisted"}=body;
    if(!videoUrl||!title) return json({ok:false,err:"missing-videoUrl-or-title"},{status:400});
    try{
      const at=await ytGetAccess();
      const vr=await fetch(videoUrl); if(!vr.ok) return json({ok:false,err:"fetch-video-failed "+vr.status},{status:400});
      const videoBuf=new Uint8Array(await vr.arrayBuffer());
      const boundary="AaB03x"+Math.random().toString(36).slice(2);
      const meta=JSON.stringify({snippet:{title,description},status:{privacyStatus}});
      const enc=new TextEncoder();
      const pre=`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: video/mp4\r\n\r\n`;
      const post=`\r\n--${boundary}--\r\n`;
      const bodyBytes=new Uint8Array(enc.encode(pre).length+videoBuf.length+enc.encode(post).length);
      bodyBytes.set(enc.encode(pre),0); bodyBytes.set(videoBuf,enc.encode(pre).length); bodyBytes.set(enc.encode(post),enc.encode(pre).length+videoBuf.length);
      const up=await fetch("https://www.googleapis.com/upload/youtube/v3/videos?part=snippet,status&uploadType=multipart",{method:"POST",headers:{"authorization":`Bearer ${at}`,"content-type":`multipart/related; boundary=${boundary}`},body:bodyBytes});
      const j=await up.json(); if(!up.ok) return json({ok:false,err:"youtube-upload-failed",detail:j},{status:400});
      return json({ok:true,videoId:j.id,response:j});
    }catch(e){ return json({ok:false,err:String(e)},{status:500}); }
  }

  // OAuth: TikTok
  if(pathname==="/oauth/tiktok/start" && req.method==="GET"){
    if(!TTK_CLIENT_KEY||!TTK_REDIRECT_URI) return json({ok:false,err:"missing-ttk-env"},{status:500});
    const scopes=["user.info.basic","video.list","video.upload"].join(",");
    const auth=new URL("https://www.tiktok.com/auth/authorize/");
    auth.searchParams.set("client_key",TTK_CLIENT_KEY);
    auth.searchParams.set("redirect_uri",TTK_REDIRECT_URI);
    auth.searchParams.set("response_type","code");
    auth.searchParams.set("scope",scopes);
    return Response.redirect(auth.toString(),302);
  }
  if(pathname==="/oauth/tiktok/callback" && req.method==="GET"){
    const code=new URL(req.url).searchParams.get("code"); if(!code) return json({ok:false,err:"missing-code"},{status:400});
    try{ const tok=await ttkExchangeCode(code); await kvSet(KV_TTK,tok);
      return new Response(`<html><body style="font-family:ui-sans-serif;background:#0b0b0c;color:#e7e7ec;"><h2>✅ TikTok połączony</h2><p>Możesz zamknąć to okno.</p></body></html>`,{headers:{"content-type":"text/html; charset=utf-8"}});
    }catch(e){ return json({ok:false,err:String(e)},{status:500}); }
  }
  if(pathname==="/api/tiktok/me" && req.method==="GET"){
    if(QDP_TOKEN && !hasAuth(req)) return json({ok:false,err:"unauthorized"},{status:401});
    try{ const at=await ttkGetAccess(); const r=await fetch("https://open.tiktokapis.com/v2/user/info/",{headers:{"authorization":`Bearer ${at}`}}); const j=await r.json(); return json({ok:true,data:j}); }
    catch(e){ return json({ok:false,err:String(e)},{status:500}); }
  }

  // GFX PRESETS
  if(pathname==="/api/gfx/get" && req.method==="GET"){
    const id=new URL(req.url).searchParams.get("id");
    const key=id?["gfx","user",id]:["gfx","default"];
    const r=await kv.get(key);
    if(r.value) return json({ok:true,scope:id?"user":"default",...r.value});
    return json({ok:true,scope:"default",preset:"high",ts:Date.now()});
  }
  if (pathname === "/api/gfx/set" && req.method === "POST") {
    if (QDP_TOKEN && !hasAuth(req)) {
      return json({ ok: false, err: "unauthorized" }, { status: 401 });
    }
    const body = await req.json().catch(() => ({}));
    const preset = (body.preset || "").toString();
    const id = (body.id || "").toString();
    const allowed = new Set(["mobile", "high", "ultra-rt"]);
    if (!allowed.has(preset)) {
      return json({ ok: false, err: "bad-preset" }, { status: 400 });
    }
    const doc = { preset, ts: Date.now() };
    const key = id ? ["gfx", "user", id] : ["gfx", "default"];
    await kv.set(key, doc);
    return json({ ok: true, saved: doc, scope: id ? "user" : "default" });
  }
