// Quantum Dashboard Pro — server.js (v10.0.0 ULTIMATE)
// Jeden plik. Wszystko w środku. Zero dokładek.
//
// WYMAGANE ENV (Deno Deploy → Settings → Environment Variables):
// - QDP_TOKEN         (wymusza autoryzację UI/API; strong secret)
// - GITHUB_TOKEN      (PAT z uprawnieniem `repo` — publish, tag, release, issues)
// - GITHUB_ORG        (opcjonalnie; domyślny owner przy publish/tag/release)
// - WEBHOOK_SECRET    (opcjonalnie; HMAC do /api/webhook/github)
//
// Opcjonalne: pliki statyczne w repo (index.html, manifest, sw.js, itp.).
// Jeśli pliku fizycznie brak, serwer użyje KV Virtual FS (klucz ["fs","/sciezka"]).

const VERSION = "10.0.0";
const kv = await Deno.openKv();

// ===== ENV & helpers =====
const QDP_TOKEN          = Deno.env.get("QDP_TOKEN") || "";
const GITHUB_TOKEN       = Deno.env.get("GITHUB_TOKEN") || "";
const GITHUB_DEFAULT_ORG = Deno.env.get("GITHUB_ORG") || "";
const WEBHOOK_SECRET     = Deno.env.get("WEBHOOK_SECRET") || "";
const REQUIRE_TOKEN      = !!QDP_TOKEN;

const CT = {
  html:"text/html; charset=utf-8", js:"text/javascript; charset=utf-8",
  json:"application/json; charset=utf-8", webmanifest:"application/manifest+json; charset=utf-8",
  css:"text/css; charset=utf-8", png:"image/png", svg:"image/svg+xml",
  txt:"text/plain; charset=utf-8"
};
function J(o,init){ return new Response(JSON.stringify(o), { headers:{ "content-type": CT.json }, ...init }); }
function authed(req){
  if(!REQUIRE_TOKEN) return true;
  const u = new URL(req.url);
  const t = u.searchParams.get("token") || req.headers.get("x-qdp-token") || "";
  return t === QDP_TOKEN;
}
function extToCT(path){
  const ext = path.split(".").pop()?.toLowerCase() || "";
  return CT[ext] || "application/octet-stream";
}
async function sha256Hex(bytes){
  const d = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,"0")).join("");
}
function b64(content){
  const enc=new TextEncoder();
  const data=(content instanceof Uint8Array)? content : enc.encode(String(content));
  let bin=""; for(const c of data) bin+=String.fromCharCode(c);
  return btoa(bin);
}
function nowISO(){ return new Date().toISOString(); }

// ===== Static + Virtual FS =====
const STATIC_WHITE = new Set([
  "/", "/index.html", "/gfx.js", "/sw.js", "/manifest.webmanifest",
  "/logo-192.png", "/logo-512.png", "/logo-maskable.png",
  "/rt/PathTracerWebGPU.js", "/assets/placeholder.txt",
  "/project.json" // obsługa też przez KV fallback
]);

async function readFileOrKv(path){ // path z wiodącym /
  try {
    const data = await Deno.readFile("." + path);
    return new Response(data, { headers:{ "content-type": extToCT(path) }});
  } catch {
    // fallback: KV virtual FS
    const r = await kv.get(["fs", path]);
    if (r.value) {
      const val = r.value;
      if (typeof val === "string") {
        return new Response(val, { headers:{ "content-type": extToCT(path) }});
      } else if (val?.b64) {
        const bin = Uint8Array.from(atob(val.b64), c=>c.charCodeAt(0));
        return new Response(bin, { headers:{ "content-type": val.ct || extToCT(path) }});
      }
    }
    return null;
  }
}

// Dodatkowo: read JSON project.json (file or KV)
async function readProjectJson(){
  // 1) Plik
  try { return JSON.parse(await Deno.readTextFile("./project.json")); }
  catch {
    // 2) KV
    const r = await kv.get(["fs", "/project.json"]);
    if (r.value) {
      try { return typeof r.value === "string" ? JSON.parse(r.value) : JSON.parse(new TextDecoder().decode(r.value)); }
      catch { /* ignore */ }
    }
    return null;
  }
}

// ===== Default Templates SEED (PRO & PRO-RT z CI/CD) =====
function seedTemplates(){
  const common = {
    ".env.example": "PORT=8000\n",
    "deno.json": "{\n  \"tasks\": { \"dev\": \"deno run -A server.ts\" }\n}\n",
    ".github/workflows/deno-ci.yml":
      "name: CI\n'on':{push:{branches:['main']},pull_request:{}}\njobs:\n  lint-format:\n    runs-on: ubuntu-latest\n    steps:\n    - uses: actions/checkout@v4\n    - uses: denoland/setup-deno@v1\n      with: { deno-version: v1.x }\n    - run: deno fmt --check\n    - run: deno lint\n",
    ".github/workflows/deploy-deno.yml":
      "name: Deploy (Deno Deploy)\n'on':{push:{branches:['main']}}\njobs:\n  deploy:\n    runs-on: ubuntu-latest\n    permissions:{contents:read,deployments:write}\n    steps:\n    - uses: actions/checkout@v4\n    - uses: denoland/setup-deno@v1\n      with:{deno-version: v1.x}\n    - name: Deploy\n      uses: denoland/deployctl@v1\n      with:\n        project: ${{ secrets.DENO_PROJECT }}\n        entrypoint: server.ts\n        token: ${{ secrets.DENO_DEPLOY_TOKEN }}\n",
    ".github/workflows/release.yml":
      "name: Release\n'on':{workflow_dispatch:{},push:{tags:['v*.*.*']}}\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n    - uses: actions/checkout@v4\n    - run: echo 'ok'\n",
    "SECURITY.md": "# Security\nReport vulnerabilities to security@yourdomain.tld\n",
    "CODEOWNERS": "* @your-github-handle\n",
    "assets/.keep": "", "assets/urf/v2/models/.keep":"", "assets/urf/v2/textures/pbr/.keep":"",
    "assets/urf/v2/lightmaps/.keep":"", "assets/urf/v2/env/.keep":"", "assets/urf/v2/audio/.keep":""
  };

  const tplPro = {
    title: "Ultra Real Football • PRO (web)",
    description: "three.js + boisko + PWA + healthz + assets v2 + CI/CD",
    files: {
      ...common,
      "README.md":
        "# URF PRO Starter\n\n- Start: `deno task dev`\n- Health: GET /healthz\n- CI/CD: .github/workflows/*\n",
      "server.ts":
        "import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';\nconst PORT=Number(Deno.env.get('PORT')||8000);\nconst index=await Deno.readTextFile('public/index.html').catch(()=>'<h1>URF PRO</h1>');\nserve((_req)=> new Response(index,{headers:{'content-type':'text/html; charset=utf-8'}}), { port: PORT });\n",
      "public/index.html":
        "<!doctype html><meta charset=utf-8><title>URF PRO</title><h1>URF PRO</h1>",
      "public/sw.js":
        "const C='urf-pro-v1';self.addEventListener('install',e=>e.waitUntil(caches.open(C).then(c=>c.addAll(['/','/index.html']))));self.addEventListener('fetch',e=>e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request))));",
      "public/manifest.webmanifest":
        "{\"name\":\"URF PRO\",\"short_name\":\"URF\",\"start_url\":\"/\",\"display\":\"standalone\"}"
    }
  };

  const tplRT = {
    title: "Ultra Real Football • PRO • RT (web)",
    description: "three.js + Path Tracing + boisko + PWA + healthz + assets v2 + CI/CD",
    files: {
      ...common,
      "README.md":
        "# URF PRO RT Starter\n\n- Start: `deno task dev`\n- Path Tracing: three-gpu-pathtracer\n- CI/CD: .github/workflows/*\n",
      "server.ts":
        "import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';\nconst PORT=Number(Deno.env.get('PORT')||8000);\nconst html=await Deno.readTextFile('public/index.html').catch(()=>'<h1>URF PRO RT</h1>');\nserve((_req)=> new Response(html,{headers:{'content-type':'text/html; charset=utf-8'}}), { port: PORT });\n",
      "public/index.html":
        "<!doctype html><meta charset=utf-8><title>URF PRO RT</title><h1>URF PRO RT</h1>",
      "public/sw.js":
        "const C='urf-pro-rt-v1';self.addEventListener('install',e=>e.waitUntil(caches.open(C).then(c=>c.addAll(['/','/index.html']))));self.addEventListener('fetch',e=>e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request))));",
      "public/manifest.webmanifest":
        "{\"name\":\"URF PRO RT\",\"short_name\":\"URF RT\",\"start_url\":\"/\",\"display\":\"standalone\"}",
      "public/rt/PathTracerWebGPU.js":
        "export class PathTracer{constructor(o){console.log('[RT] stub',o)}render(){}dispose(){}}"
    }
  };

  return { "game-urf-pro": tplPro, "game-urf-pro-rt": tplRT };
}

async function ensureTplRegistry(){
  const cur = await kv.get(["tpl","registry"]);
  if (cur.value && cur.value.templates && Object.keys(cur.value.templates).length) return cur.value;
  const reg = {
    version: "2025.09.08-ultimate",
    updatedAt: Date.now(),
    templates: seedTemplates()
  };
  await kv.set(["tpl","registry"], reg);
  return reg;
}

// ===== GFX =====
async function apiGfx(req,u){
  if(u.pathname==="/api/gfx/get" && req.method==="GET"){
    const id=u.searchParams.get("id"); const key=id?["gfx","user",id]:["gfx","default"]; const r=await kv.get(key);
    return J({ok:true, scope:id?"user":"default", preset:(r.value?.preset)||"high", ts:r.value?.ts||Date.now()});
  }
  if(u.pathname==="/api/gfx/set" && req.method==="POST"){
    if(REQUIRE_TOKEN && !authed(req)) return J({ok:false,err:"unauthorized"},{status:401});
    const body=await req.json().catch(()=>({})); const preset=String(body.preset||""); const id=body.id?String(body.id):"";
    const okset=new Set(["mobile","high","ultra-rt"]); if(!okset.has(preset)) return J({ok:false,err:"bad-preset"},{status:400});
    const key=id?["gfx","user",id]:["gfx","default"]; const doc={preset,ts:Date.now()}; await kv.set(key,doc); return J({ok:true,saved:doc});
  }
  return null;
}

// ===== Release =====
async function apiRelease(req,u){
  if(u.pathname==="/api/release/get" && req.method==="GET"){
    const project=u.searchParams.get("project")||"global"; const r=await kv.get(["release",project]);
    return J({ok:true,project,data:r.value||{build:0,assetsVersion:"v1",ts:0}});
  }
  if(u.pathname==="/api/release/set" && req.method==="POST"){
    if(REQUIRE_TOKEN && !authed(req)) return J({ok:false,err:"unauthorized"},{status:401});
    const b=await req.json().catch(()=>({})); const project=String(b.project||"global"); const bump=!!b.bump; const assets=b.assetsVersion?String(b.assetsVersion):"";
    const r=await kv.get(["release",project]); const cur=r.value||{build:0,assetsVersion:"v1",ts:0};
    const next={build:bump?(cur.build|0)+1:(cur.build|0),assetsVersion:assets||cur.assetsVersion,ts:Date.now()};
    await kv.set(["release",project],next); return J({ok:true,project,saved:next});
  }
  return null;
}

// ===== Projects / Health =====
async function apiHealthAll(req,u){
  if(u.pathname==="/api/health/all" && req.method==="GET"){
    const pj=await readProjectJson(); if(!pj) return J({ok:false,err:"no-project-json"},{status:404});
    const outs=await Promise.all((pj.projects||[]).map(async p=>{
      const target=p.health_url||p.deploy_url||p.entry||"";
      if(!target) return {id:p.id,ok:false,err:"no-url"};
      try{ const r=await fetch(target,{method:"GET",redirect:"manual"}); return {id:p.id,url:target,status:r.status,ok:(r.ok||(r.status>=200&&r.status<400))}; }
      catch(e){ return {id:p.id,url:target,ok:false,err:String(e)}; }
    }));
    return J({ok:true,results:outs});
  }
  return null;
}

// ===== Virtual FS API =====
// GET /api/fs/get?path=/project.json
// POST /api/fs/set { path, content (string) | b64, ct? }
async function apiFs(req,u){
  if(u.pathname==="/api/fs/get" && req.method==="GET"){
    if(REQUIRE_TOKEN && !authed(req)) return J({ok:false,err:"unauthorized"},{status:401});
    const path = u.searchParams.get("path") || "";
    if(!path.startsWith("/")) return J({ok:false,err:"path-must-start-with-slash"},{status:400});
    const r = await kv.get(["fs", path]);
    if(!r.value) return J({ok:false,err:"not-found"},{status:404});
    return J({ok:true, path, meta:{ct: r.value.ct||extToCT(path), kind: r.value.b64?"b64":"text"}});
  }
  if(u.pathname==="/api/fs/set" && req.method==="POST"){
    if(REQUIRE_TOKEN && !authed(req)) return J({ok:false,err:"unauthorized"},{status:401});
    const b = await req.json().catch(()=>({}));
    const path = String(b.path||"");
    if(!path.startsWith("/")) return J({ok:false,err:"path-must-start-with-slash"},{status:400});
    let val;
    if(b.b64){ val = { b64: String(b.b64), ct: b.ct||extToCT(path), ts: Date.now() }; }
    else     { val = String(b.content||""); }
    await kv.set(["fs", path], val);
    return J({ok:true, path});
  }
  return null;
}

// ===== Templates / Scaffold / Publish =====
async function apiTemplates(req,u){
  if(u.pathname==="/api/templates/get" && req.method==="GET"){
    const reg=await ensureTplRegistry(); return J({ok:true,registry:reg});
  }
  if(u.pathname==="/api/templates/set" && req.method==="POST"){
    if(REQUIRE_TOKEN && !authed(req)) return J({ok:false,err:"unauthorized"},{status:401});
    const b=await req.json().catch(()=>null); if(!b||!b.templates) return J({ok:false,err:"bad-body"},{status:400});
    const reg=await ensureTplRegistry(); const merged={...reg,version:b.version||reg.version,updatedAt:Date.now(),templates:{...reg.templates,...b.templates}};
    await kv.set(["tpl","registry"],merged); return J({ok:true,registry:merged});
  }
  if(u.pathname==="/api/scaffold/bootstrap" && req.method==="POST"){
    const b=await req.json().catch(()=>({})); const name=String((b.name||"My Project")).trim();
    const slug=(b.slug?String(b.slug):name.toLowerCase().replace(/[^a-z0-9]+/g,"-")).replace(/^-+|-+$/g,""); const template=String(b.template||"game-urf-pro");
    const reg=await ensureTplRegistry(); const tpl=reg.templates[template]; if(!tpl) return J({ok:false,err:"unknown-template"},{status:400});
    const out=[]; out.push("#!/usr/bin/env bash","set -euo pipefail",`echo \"Creating project: ${slug}\"`,`mkdir -p \"${slug}\" && cd \"${slug}\"`);
    for(const [p,c] of Object.entries(tpl.files)){ const dir=p.split("/").slice(0,-1).join("/"); if(dir) out.push(`mkdir -p "${dir}"`); out.push(`cat > "${p}" <<'EOF__QDP'`,String(c),`EOF__QDP`); }
    out.push("git init >/dev/null 2>&1 || true",'echo \"✅ Done. Next: deno task dev || deno run -A server.ts\"');
    return new Response(out.join("\n"),{headers:{"content-type":"text/x-sh; charset=utf-8","content-disposition":`attachment; filename="${slug}-bootstrap.sh"`}});
  }
  return null;
}

async function ghOwner(){
  if(GITHUB_DEFAULT_ORG) return GITHUB_DEFAULT_ORG;
  const r=await fetch("https://api.github.com/user",{headers:{Authorization:`Bearer ${GITHUB_TOKEN}`,"Accept":"application/vnd.github+json"}});
  const j=await r.json(); return j.login;
}
async function apiPublish(req,u){
  if(u.pathname==="/api/scaffold/publish" && req.method==="POST"){
    if(!GITHUB_TOKEN) return J({ok:false,err:"missing-GITHUB_TOKEN"},{status:400});
    if(REQUIRE_TOKEN && !authed(req)) return J({ok:false,err:"unauthorized"},{status:401});
    const b=await req.json().catch(()=>({})); let owner=String(b.owner||""); const repo=String(b.repo||"").toLowerCase().replace(/[^a-z0-9._-]/g,"-"); const branch=String(b.branch||"main");
    if(!repo) return J({ok:false,err:"missing-repo"},{status:400});
    if(!owner) owner = await ghOwner();

    const createUrl = GITHUB_DEFAULT_ORG
      ? `https://api.github.com/orgs/${encodeURIComponent(owner)}/repos`
      : `https://api.github.com/user/repos`;

    const cr=await fetch(createUrl,{method:"POST",headers:{Authorization:`Bearer ${GITHUB_TOKEN}`,"Accept":"application/vnd.github+json"},body:JSON.stringify({name:repo,description:b.description||"Created by Quantum Dashboard Pro",private:!!b.private,auto_init:false})});
    if(!cr.ok && cr.status!==422) return J({ok:false,err:"create-repo-failed",status:cr.status,text:await cr.text()},{status:502});

    const files=b.files&&Object.keys(b.files).length?b.files:{};
    if(b.template){ const reg=await ensureTplRegistry(); const tpl=reg.templates[String(b.template)]; if(!tpl) return J({ok:false,err:"unknown-template"},{status:400}); for(const [p,c] of Object.entries(tpl.files)) files[p]=c; }
    if(!("README.md" in files)) files["README.md"] = `# ${repo}\n\nGenerated by Quantum Dashboard Pro.`;

    const base=`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/`;
    for(const [p,c] of Object.entries(files)){
      const r=await fetch(base+encodeURIComponent(p),{method:"PUT",headers:{Authorization:`Bearer ${GITHUB_TOKEN}`,"Accept":"application/vnd.github+json"},body:JSON.stringify({message:`add ${p}`,content:b64(c),branch})});
      if(!r.ok) return J({ok:false,err:`put-${p}-failed`,status:r.status,text:await r.text()},{status:502});
    }
    await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,{method:"PATCH",headers:{Authorization:`Bearer ${GITHUB_TOKEN}`,"Accept":"application/vnd.github+json"},body:JSON.stringify({default_branch:branch})}).catch(()=>{});
    return J({ok:true,owner,repo,branch,html_url:`https://github.com/${owner}/${repo}`});
  }
  return null;
}

// ===== Assets Manifest =====
async function apiAssets(req,u){
  if(u.pathname==="/api/assets/manifest" && req.method==="POST"){
    const b=await req.json().catch(()=>({})); const base=String(b.baseUrl||"").replace(/\/+$/,""); const files=Array.isArray(b.files)?b.files:[];
    const manifest={};
    for(const p of files){
      const url=base?`${base}/${p.replace(/^\/+/,"")}`:p;
      try{
        const r=await fetch(url,{method:"GET"});
        if(!r.ok){ manifest[p]={ok:false,status:r.status,url}; continue; }
        const buf=new Uint8Array(await r.arrayBuffer()); const hash=await sha256Hex(buf);
        manifest[p]={ok:true,size:buf.byteLength,sha256:hash,url};
      }catch(e){ manifest[p]={ok:false,err:String(e),url}; }
    }
    return J({ok:true,ts:Date.now(),manifest});
  }
  return null;
}

// ===== GitHub automations =====
async function ghCreateTag(owner,repo,tag,shaBase){
  if(!shaBase){
    const ri=await fetch(`https://api.github.com/repos/${owner}/${repo}`,{headers:{Authorization:`Bearer ${GITHUB_TOKEN}`}}); const ji=await ri.json(); const branch=ji.default_branch||"main";
    const rr=await fetch(`https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${branch}`,{headers:{Authorization:`Bearer ${GITHUB_TOKEN}`}}); const jr=await rr.json(); shaBase=jr.object?.sha;
  }
  const refResp=await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs`,{
    method:"POST",headers:{Authorization:`Bearer ${GITHUB_TOKEN}`,"Accept":"application/vnd.github+json"},
    body:JSON.stringify({ref:`refs/tags/${tag}`, sha:shaBase})
  });
  if(!refResp.ok && refResp.status!==422) return {ok:false,status:refResp.status,text:await refResp.text()};
  return {ok:true};
}
async function ghCreateRelease(owner,repo,tag,name,notes,opt){
  const r=await fetch(`https://api.github.com/repos/${owner}/${repo}/releases`,{
    method:"POST",headers:{Authorization:`Bearer ${GITHUB_TOKEN}`,"Accept":"application/vnd.github+json"},
    body:JSON.stringify({tag_name:tag,name:name||tag,body:notes||"",draft:!!opt?.draft,prerelease:!!opt?.prerelease,generate_release_notes:!!opt?.generate_notes})
  });
  const j=await r.json(); if(!r.ok) return {ok:false,status:r.status,text:JSON.stringify(j)};
  return {ok:true,url:j.html_url,id:j.id};
}
async function ghCreateIssue(owner,repo,title,body,labels){
  const r=await fetch(`https://api.github.com/repos/${owner}/${repo}/issues`,{
    method:"POST",headers:{Authorization:`Bearer ${GITHUB_TOKEN}`,"Accept":"application/vnd.github+json"},
    body:JSON.stringify({title,body,labels:labels||[]})
  });
  const j=await r.json(); if(!r.ok) return {ok:false,status:r.status,text:JSON.stringify(j)};
  return {ok:true,url:j.html_url,number:j.number};
}

async function apiGitHub(req,u){
  if(u.pathname==="/api/github/tag" && req.method==="POST"){
    if(!GITHUB_TOKEN) return J({ok:false,err:"missing-GITHUB_TOKEN"},{status:400});
    if(REQUIRE_TOKEN && !authed(req)) return J({ok:false,err:"unauthorized"},{status:401});
    const b=await req.json().catch(()=>({})); const owner=b.owner||await ghOwner(); const repo=b.repo; const tag=b.tag;
    if(!repo||!tag) return J({ok:false,err:"repo/tag required"},{status:400});
    const r=await ghCreateTag(owner,repo,tag,b.sha); return J({...r,owner,repo,tag});
  }
  if(u.pathname==="/api/github/release" && req.method==="POST"){
    if(!GITHUB_TOKEN) return J({ok:false,err:"missing-GITHUB_TOKEN"},{status:400});
    if(REQUIRE_TOKEN && !authed(req)) return J({ok:false,err:"unauthorized"},{status:401});
    const b=await req.json().catch(()=>({})); const owner=b.owner||await ghOwner(); const repo=b.repo; const tag=b.tag; if(!repo||!tag) return J({ok:false,err:"repo/tag required"},{status:400});
    const res=await ghCreateRelease(owner,repo,tag,b.name,b.notes,{draft:b.draft,prerelease:b.prerelease,generate_notes:b.generate_notes}); return J({...res,owner,repo,tag});
  }
  if(u.pathname==="/api/github/issue" && req.method==="POST"){
    if(!GITHUB_TOKEN) return J({ok:false,err:"missing-GITHUB_TOKEN"},{status:400});
    if(REQUIRE_TOKEN && !authed(req)) return J({ok:false,err:"unauthorized"},{status:401});
    const b=await req.json().catch(()=>({})); const owner=b.owner||await ghOwner(); const repo=b.repo; if(!repo) return J({ok:false,err:"repo required"},{status:400});
    const r=await ghCreateIssue(owner,repo,b.title||"Issue",b.body||"",b.labels||[]); return J({...r,owner,repo});
  }
  return null;
}

// ===== AUTO flows =====
async function apiAuto(req,u){
  if(u.pathname==="/api/auto/health-to-issues" && req.method==="POST"){
    if(!GITHUB_TOKEN) return J({ok:false,err:"missing-GITHUB_TOKEN"},{status:400});
    if(REQUIRE_TOKEN && !authed(req)) return J({ok:false,err:"unauthorized"},{status:401});
    const b=await req.json().catch(()=>({})); const repoFull=String(b.repo||"").trim(); if(!repoFull) return J({ok:false,err:"repo required (owner/name)"},{status:400});
    const [owner,repo]=repoFull.split("/");
    const health = await (await apiHealthAll(new Request("GET"), new URL("http://x/api/health/all"))).json();
    if(!health.ok) return J(health,{status:400});
    const fails=(health.results||[]).filter(r=>!r.ok); const created=[];
    for(const f of fails){
      const title=`${f.id}: health failed (${f.status||f.err||"no-status"})`;
      const body=`**ID**: ${f.id}\n**URL**: ${f.url||"-"}\n**When**: ${nowISO()}\n**Details**: ${f.err||("status "+f.status)}\n`;
      const r=await ghCreateIssue(owner,repo,title,body,["health","auto"]); if(r.ok) created.push(r.url);
    }
    return J({ok:true,count:created.length,created});
  }

  if(u.pathname==="/api/auto/bump-tag-release" && req.method==="POST"){
    if(!GITHUB_TOKEN) return J({ok:false,err:"missing-GITHUB_TOKEN"},{status:400});
    if(REQUIRE_TOKEN && !authed(req)) return J({ok:false,err:"unauthorized"},{status:401});
    const b=await req.json().catch(()=>({}));
    const project=String(b.project||"global"); const repoFull=String(b.repo||"").trim(); const base=String(b.semverBase||"");
    if(!repoFull) return J({ok:false,err:"repo required (owner/name)"},{status:400});
    const [owner,repo]=repoFull.split("/");

    const r0=await kv.get(["release",project]); const cur=r0.value||{build:0,assetsVersion:"v1",ts:0};
    const next={build:(cur.build|0)+1, assetsVersion:cur.assetsVersion||"v1", ts:Date.now()};
    await kv.set(["release",project],next);
    const tag = base ? `v${base}.${next.build}` : `${next.assetsVersion}-${next.build}`;
    const tagRes=await ghCreateTag(owner,repo,tag);
    if(!tagRes.ok) return J({ok:false,step:"tag",err:tagRes},{status:502});
    const relRes=await ghCreateRelease(owner,repo,tag,`Release ${tag}`,`Automated release for ${project}\nBuild: ${next.build}\nAssets: ${next.assetsVersion}`,{generate_notes:true});
    if(!relRes.ok) return J({ok:false,step:"release",err:relRes},{status:502});
    return J({ok:true,project,build:next.build,tag,release_url:relRes.url});
  }
  return null;
}

// ===== Webhook (GitHub) =====
async function apiWebhook(req,u){
  if(u.pathname==="/api/webhook/github" && req.method==="POST"){
    if(WEBHOOK_SECRET){
      const sig=req.headers.get("x-hub-signature-256")||"";
      const body=new Uint8Array(await req.arrayBuffer());
      const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(WEBHOOK_SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
      const mac=await crypto.subtle.sign("HMAC",key,body);
      const hex="sha256="+[...new Uint8Array(mac)].map(b=>b.toString(16).padStart(2,"0")).join("");
      if(hex!==sig) return J({ok:false,err:"bad-signature"},{status:401});
      await kv.set(["webhook","last"],{ts:Date.now(),event:req.headers.get("x-github-event")||"",sig:hex});
      return new Response(null,{status:204});
    } else {
      const payload=await req.json().catch(()=>({}));
      await kv.set(["webhook","last"],{ts:Date.now(),event:req.headers.get("x-github-event")||"",payload});
      return new Response(null,{status:204});
    }
  }
  return null;
}

// ===== HTTP router =====
Deno.serve(async (req)=>{
  const u = new URL(req.url);

  if(u.pathname==="/healthz") return J({ok:true,service:"qdp-dashboard",version:VERSION,ts:Date.now()});
  if(u.pathname==="/version") return J({ok:true,version:VERSION,ts:Date.now()});

  // APIs (pełny komplet)
  const api =
    (u.pathname.startsWith("/api/gfx/")        && await apiGfx(req,u)) ||
    (u.pathname.startsWith("/api/release/")    && await apiRelease(req,u)) ||
    (u.pathname.startsWith("/api/health/")     && await apiHealthAll(req,u)) ||
    (u.pathname.startsWith("/api/fs/")         && await apiFs(req,u)) ||
    ((u.pathname.startsWith("/api/templates/") || u.pathname.startsWith("/api/scaffold/")) && (await apiTemplates(req,u) || await apiPublish(req,u))) ||
    (u.pathname.startsWith("/api/assets/")     && await apiAssets(req,u)) ||
    (u.pathname.startsWith("/api/github/")     && await apiGitHub(req,u)) ||
    (u.pathname.startsWith("/api/auto/")       && await apiAuto(req,u)) ||
    (u.pathname.startsWith("/api/webhook/")    && await apiWebhook(req,u));

  if (api) return api;

  // Statyki i /project.json z KV fallback
  if (STATIC_WHITE.has(u.pathname)) {
    const s = await readFileOrKv(u.pathname);
    if (s) return s;
  }

  return new Response("Not found",{status:404});
});
