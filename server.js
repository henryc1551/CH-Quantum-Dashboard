// CH-Quantum Dashboard • Secure server for Deno Deploy (pretty login + pretty 404)
// v3.9.0
const V = "3.9.0";

// ==== ENV (Deno → Project → Settings → Environment Variables) ====
// QDP_TOKEN          – tajny token dostępu do panelu (włącza bramkę)
// QDP_COOKIE_DAYS    – ile dni pamiętać cookie (domyślnie 30)
const ACCESS_TOKEN = (Deno.env.get("QDP_TOKEN") || "").trim();
const COOKIE_DAYS  = Math.max(1, parseInt(Deno.env.get("QDP_COOKIE_DAYS") || "30", 10));

const MIME = {
  ".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",".js":"application/javascript; charset=utf-8",
  ".json":"application/json; charset=utf-8",".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",".svg":"image/svg+xml",
  ".ico":"image/x-icon",".webmanifest":"application/manifest+json",".txt":"text/plain; charset=utf-8",".zip":"application/zip"
};

function sec(){
  return {
    "x-content-type-options":"nosniff",
    "referrer-policy":"strict-origin-when-cross-origin",
    // pozwalamy inline (UI), blokujemy zewnętrzne źródła poza https: w connect/img/media
    "content-security-policy":
      "default-src 'self' 'unsafe-inline' data: blob:; connect-src 'self' https:; img-src 'self' data:; media-src 'self' https:; frame-ancestors 'none';",
    "x-robots-tag":"noindex, nofollow, noarchive",
    "access-control-allow-origin":"*",
    "access-control-allow-methods":"GET,POST,OPTIONS",
    "access-control-allow-headers":"content-type,authorization"
  };
}
function json(data,status=200,h={}){return new Response(JSON.stringify(data,null,2),{status,headers:{"content-type":"application/json; charset=utf-8",...sec(),...h}});}

const COOKIE_NAME="qd_auth";
function cookieSetHeader(days){ return `${COOKIE_NAME}=1; Path=/; Max-Age=${days*86400}; HttpOnly; SameSite=Lax`; }
function cookieClrHeader(){ return `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`; }
function hasCookie(req){ const c=req.headers.get("cookie")||""; return new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=1(?:;|$)`).test(c); }

function isPublic(u){
  return ["/healthz","/version","/robots.txt","/landing.html","/landing-en.html","/manifest.webmanifest","/logout"].includes(u.pathname)
      || /^\/icon-/.test(u.pathname) || /^\/logo-/.test(u.pathname);
}

function loginHTML({error=""}={}){
  const err = error ? `<div class="err">${error}</div>` : "";
  return `<!doctype html><html lang="pl"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>CH-Quantum • Login</title>
<style>
:root{--bg:#0b0f14;--fg:#e7edf3;--mut:#97a3af;--card:#121a23;--line:#213041;--acc:#ff7a18}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px system-ui,Segoe UI,Roboto,Arial}
.wrap{min-height:100svh;display:grid;place-items:center;padding:24px}
.card{width:100%;max-width:420px;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:20px;box-shadow:0 8px 30px rgba(0,0,0,.35)}
.brand{display:flex;align-items:center;gap:10px;margin-bottom:8px}
.brand img{width:36px;height:36px}
h1{margin:4px 0 14px 0;font-size:1.4rem}
p.mut{color:var(--mut);margin:.2rem 0 1rem}
label{display:block;margin:.5rem 0 .3rem}
input{width:100%;padding:12px;border-radius:12px;border:1px solid var(--line);background:#0e1620;color:var(--fg)}
.btn{width:100%;margin-top:14px;padding:12px;border-radius:12px;border:none;font-weight:800;background:var(--acc);color:#111}
.meta{display:flex;justify-content:space-between;align-items:center;margin-top:10px;color:var(--mut);font-size:.9rem}
.err{margin:10px 0;padding:10px;border-radius:10px;background:#2a0f12;border:1px solid #5a1c21;color:#ffb2b2}
.tip{font-size:.85rem;color:var(--mut);margin-top:10px}
@media (prefers-color-scheme: light){
  body{background:#f4f6f9;color:#111}.card{background:#fff;border-color:#ddd}
  input{background:#fff;color:#111;border-color:#ddd}
}
</style></head><body>
<div class="wrap">
  <form class="card" method="POST" action="/auth">
    <div class="brand"><img src="/logo-dark.svg" alt="Q"><strong>CH-Quantum • WayPro</strong></div>
    <h1>Logowanie</h1>
    <p class="mut">Panel jest prywatny. Użyj swojego <em>Access Token</em>, aby wejść.</p>
    ${err}
    <label for="token">Access Token</label>
    <input id="token" name="token" type="password" placeholder="********" autocomplete="current-password" autofocus>
    <label style="display:flex;gap:.6rem;align-items:center;margin-top:.6rem">
      <input type="checkbox" name="remember" checked> Pamiętaj mnie
    </label>
    <button class="btn">Wejdź</button>
    <div class="meta"><span>v${V}</span><a href="/landing-en.html" target="_blank">English landing</a></div>
    <p class="tip">Możesz też wejść dopisując <code>?token=…</code> do URL lub nagłówkiem <code>Authorization: Bearer …</code>.</p>
  </form>
</div>
</body></html>`;
}

function pretty404HTML(path="/"){
  return `<!doctype html><html lang="pl"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>404 • CH-Quantum</title>
<style>
:root{--bg:#0b0f14;--fg:#e7edf3;--mut:#97a3af;--card:#121a23;--line:#213041;--acc:#ff7a18}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px system-ui,Segoe UI,Roboto,Arial}
.wrap{min-height:100svh;display:grid;place-items:center;padding:24px;text-align:center}
.card{max-width:560px;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:24px}
h1{font-size:2rem;margin:0 0 6px 0}
p{color:var(--mut)} .actions{margin-top:14px}
a.btn{display:inline-block;padding:10px 14px;border-radius:12px;background:var(--acc);color:#111;text-decoration:none;font-weight:800}
small{display:block;margin-top:10px;color:var(--mut)}
</style></head><body>
<div class="wrap">
  <div class="card">
    <h1>404 — Nie znaleziono</h1>
    <p>Ścieżka <code>${path}</code> nie istnieje.</p>
    <div class="actions"><a class="btn" href="/">Wróć do Dashboardu</a></div>
    <small>CH-Quantum • WayPro</small>
  </div>
</div>
</body></html>`;
}

async function serveFile(pathname){
  const safe = pathname.replace(/\/+/g,"/").replace(/\.\./g,"");
  const file = safe === "/" ? "/index.html" : safe;
  try{
    const url=new URL(`.${file}`, import.meta.url);
    const ext=file.match(/\.[^.]+$/)?.[0].toLowerCase()||".txt";
    const mime=MIME[ext]||"application/octet-stream";
    const res=await fetch(url); if(!res.ok) return null;
    const h=new Headers(res.headers); h.set("content-type", mime);
    if (ext===".css"||ext===".js") h.set("cache-control","public,max-age=3600");
    Object.entries(sec()).forEach(([k,v])=>h.set(k,v));
    return new Response(res.body, { status:200, headers:h });
  }catch{ return null; }
}

function gateEnabled(){ return !!ACCESS_TOKEN; }
function pathNeedsAuth(u){ return !(isPublic(u) || !gateEnabled()); }

function extractIncomingToken(req,u){
  const auth=req.headers.get("authorization")||""; const qtok=u.searchParams.get("token")||"";
  if (qtok) return qtok.trim();
  if (/^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i,"").trim();
  if (/^Basic\s+/i.test(auth)) {
    try{ const dec=atob(auth.replace(/^Basic\s+/i,"").trim()); const [,pass=""]=dec.split(":"); return pass.trim(); }catch{}
  }
  return "";
}

Deno.serve(async (req) => {
  const u = new URL(req.url);

  // Preflight
  if (req.method==="OPTIONS") return new Response(null,{status:204,headers:sec()});

  // Public: health/version/robots/landing
  if (u.pathname==="/healthz") return json({ok:true,ts:Date.now(),version:V});
  if (u.pathname==="/version") return json({ok:true,version:V});
  if (u.pathname==="/robots.txt") return new Response("User-agent: *\nDisallow: /",{headers:{"content-type":"text/plain; charset=utf-8",...sec()}});
  if (u.pathname==="/logout") return new Response(null,{status:302,headers:{...sec(),"set-cookie":cookieClrHeader(),"location":"/auth"}});

  // Gate
  if (pathNeedsAuth(u)) {
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

  // Demo API
  if (u.pathname==="/api/echo" && req.method==="POST"){
    let body={}; try{ body=await req.json(); }catch{}
    return json({ok:true,youSent:body});
  }

  // Statyczne pliki (UI, PWA, logos, landing, starters)
  const asset = await serveFile(u.pathname);
  if (asset) return asset;

  // Ładna 404 (brand)
  return new Response(pretty404HTML(u.pathname),{status:404,headers:{"content-type":"text/html; charset=utf-8",...sec()}});
});
