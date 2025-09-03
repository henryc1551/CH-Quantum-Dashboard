<!-- app.js -->
<script>
/* Tiny SPA for Quantum Dashboard (WayPro) */

const S = {
  ver: "6.2.1",
  routes: ["home","files","chat","actions","settings"],
  el: {},
  state: {
    projects: JSON.parse(localStorage.getItem("projects")||"[]"),
    files: JSON.parse(localStorage.getItem("files")||"[]"),
    chat: JSON.parse(localStorage.getItem("chatHistory")||"[]"),
    theme: localStorage.getItem("theme")||"auto",
  }
};

function $(sel, root=document){ return root.querySelector(sel); }
function $all(sel, root=document){ return [...root.querySelectorAll(sel)]; }
function save(key){ localStorage.setItem(key, JSON.stringify(S.state[key])); }
function toast(msg){
  const t = document.createElement("div");
  t.className="toast";
  t.textContent=msg;
  document.body.appendChild(t);
  requestAnimationFrame(()=>t.classList.add("show"));
  setTimeout(()=>{ t.classList.remove("show"); t.remove(); }, 2200);
}

function setRoute(route){
  if(!S.routes.includes(route)) route="home";
  location.hash = "#"+route;
  render(route);
}

function render(route){
  // nav active
  $all("[data-route]").forEach(b=>{
    b.classList.toggle("active", b.dataset.route===route);
  });
  // panels
  S.routes.forEach(r=>{
    const panel = $("#panel-"+r);
    if(panel) panel.hidden = (r!==route);
  });
  // special renders
  if(route==="files") renderFiles();
  if(route==="chat") renderChat();
  if(route==="actions") renderActions();
  if(route==="settings") renderSettings();
  if(route==="home") renderHome();
}

function renderHome(){
  const c = $("#home-summary");
  c.innerHTML = `
    <div class="stats">
      <div><b>Projects</b><span>${S.state.projects.length}</span></div>
      <div><b>Files</b><span>${S.state.files.length}</span></div>
      <div><b>Chat msgs</b><span>${S.state.chat.length}</span></div>
      <div><b>Version</b><span>${S.ver}</span></div>
    </div>
    <div class="tips">
      <p>Start here → Create a project (Actions → “Starter: Ultra Real Football”).</p>
      <p>Need debug? Open <code>?debug=1</code> in URL.</p>
    </div>
  `;
}
function renderFiles(){
  const list = $("#files-list");
  if(!S.state.files.length){
    list.innerHTML = `<p class="muted">No files yet. Use “Add file” below.</p>`;
    return;
  }
  list.innerHTML = S.state.files.map((f,i)=>`
    <div class="row">
      <div class="grow">
        <b>${f.name}</b><br/><small>${(f.size||0)} bytes • ${f.type||"text/plain"}</small>
      </div>
      <button class="btn ghost" data-del-file="${i}">Delete</button>
    </div>
  `).join("");
}
function renderChat(){
  const box = $("#chat-box");
  box.innerHTML = S.state.chat.slice(-50).map(m=>
    `<div class="msg ${m.role}">
      <div class="who">${m.role.toUpperCase()}</div>
      <div class="text">${escapeHtml(m.text)}</div>
    </div>`).join("");
  box.scrollTop = box.scrollHeight;
}
function renderActions(){
  $("#starters").innerHTML = `
    <div class="card">
      <div>
        <h4>Ultra Real Football (demo)</h4>
        <p>Create project with starter files.</p>
      </div>
      <button class="btn" id="mk-urf">Create</button>
    </div>
    <div class="card">
      <div>
        <h4>Portfolio Landing</h4>
        <p>Generate a simple landing page project.</p>
      </div>
      <button class="btn" id="mk-landing">Create</button>
    </div>
  `;
}
function renderSettings(){
  $("#theme-select").value = S.state.theme;
}
function escapeHtml(s){
  return s.replace(/[&<>"']/g, m=>({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  })[m]);
}

/* Actions */
document.addEventListener("click",(e)=>{
  const r = e.target.closest("[data-route]"); if(r){ setRoute(r.dataset.route); return; }

  const del = e.target.closest("[data-del-file]");
  if(del){
    const idx = +del.dataset.delFile;
    S.state.files.splice(idx,1); save("files"); renderFiles(); toast("File removed");
    return;
  }

  if(e.target.id==="add-file"){
    const name = prompt("File name (e.g. notes.txt)"); if(!name) return;
    S.state.files.push({name, size:0, type:"text/plain", ts:Date.now()});
    save("files"); renderFiles(); toast("File added");
    return;
  }
  if(e.target.id==="mk-urf"){
    createProject("Ultra Real Football","game/urf-demo");
    return;
  }
  if(e.target.id==="mk-landing"){
    createProject("Portfolio Landing","web/landing");
    return;
  }
  if(e.target.id==="send-msg"){
    const inp = $("#chat-input"); const text = inp.value.trim(); if(!text) return;
    S.state.chat.push({role:"user", text, ts:Date.now()}); save("chat");
    renderChat();
    inp.value="";
    // fake assistant reply
    setTimeout(()=>{
      S.state.chat.push({role:"assistant", text:"Got it. Building…", ts:Date.now()});
      save("chat"); renderChat();
    }, 500);
  }
});

$("#theme-select")?.addEventListener("change",(e)=>{
  S.state.theme = e.target.value; localStorage.setItem("theme", S.state.theme);
  applyTheme(); toast("Theme updated");
});

function createProject(name, kind){
  const id = "p_"+Math.random().toString(36).slice(2,10);
  S.state.projects.push({id,name,kind,ts:Date.now(),status:"draft"});
  save("projects");
  toast("Project created");
}

function applyTheme(){
  const t = S.state.theme;
  document.documentElement.dataset.theme = t;
}
function init(){
  S.el.app = $("#app");
  // wire nav
  $all("[data-route]").forEach(b=> b.addEventListener("keydown",(e)=>{
    if(e.key==="Enter"||e.key===" "){ e.preventDefault(); setRoute(b.dataset.route); }
  }));

  // router by hash
  window.addEventListener("hashchange", ()=>render(location.hash.slice(1)));
  applyTheme();

  const route = location.hash.slice(1) || "home";
  render(route);

  // debug overlay
  const debug = new URLSearchParams(location.search).get("debug");
  if(debug==="1"){
    const d = document.createElement("pre");
    d.id="debug";
    d.textContent="DEBUG ON";
    document.body.appendChild(d);
    setInterval(()=>{
      d.textContent = "DEBUG "+new Date().toLocaleTimeString()+"\n"+
        JSON.stringify(S.state,null,2);
    }, 1000);
  }
}
document.addEventListener("DOMContentLoaded", init);
</script>
