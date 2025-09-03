const $ = (id) => document.getElementById(id);
const api = async (url, init) => (await fetch(url, init)).json();

/* Auth (jeśli masz inputs na landing) */
if (document.getElementById("btnWhoami")) {
  btnWhoami.onclick = async () => { me.textContent = JSON.stringify(await api("/api/me"), null, 2); };
  btnBootstrap.onclick = async () => { const r = await api("/api/admin/bootstrap", { method:"POST" }); alert(r.msg || JSON.stringify(r)); btnWhoami.click(); };
  btnRegister.onclick = async () => {
    const r = await api("/api/auth/register", { method:"POST", headers:{ "content-type":"application/json" }, body: JSON.stringify({ email: email.value, password: password.value }) });
    alert(JSON.stringify(r));
  };
  btnLogin.onclick = async () => {
    const r = await api("/api/auth/login", { method:"POST", headers:{ "content-type":"application/json" }, body: JSON.stringify({ email: email.value, password: password.value }) });
    me.textContent = r.ok ? "Zalogowano" : JSON.stringify(r);
  };
  btnLogout.onclick = async () => { await api("/api/auth/logout", { method:"POST" }); me.textContent = "Wylogowano"; };
}

/* Chat (WS) + slash-commands */
if (document.getElementById("log")) {
  let ws;
  function connectWS() {
    ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws");
    ws.onmessage = (e) => { const d = JSON.parse(e.data); const line = document.createElement("div"); line.textContent = new Date(d.ts).toLocaleTimeString() + " • " + (d.text || JSON.stringify(d)); log.appendChild(line); log.scrollTop = log.scrollHeight; };
    ws.onclose = () => setTimeout(connectWS, 1200);
  }
  connectWS();

  async function execCommand(text) {
    const r = await fetch("/api/commands/execute", { method:"POST", headers:{ "content-type":"application/json" }, body: JSON.stringify({ text }) });
    const j = await r.json();
    const line = document.createElement("div");
    line.textContent = "[cmd] " + (r.ok ? JSON.stringify(j) : (j.error || "command error"));
    log.appendChild(line); log.scrollTop = log.scrollHeight;
  }

  btnSend.onclick = async () => {
    const t = msg.value.trim(); if (!t) return;
    if (t.startsWith("/") || /^stw[oó]rz\s+projekt/i.test(t) || /^create\s+projekt/i.test(t)) {
      await execCommand(t);
    } else {
      if (!ws || ws.readyState !== 1) return alert("Łączenie…");
      ws.send(JSON.stringify({ text: t }));
    }
    msg.value = "";
  };
  btnLoad.onclick = async () => {
    const r = await api("/api/chat/history"); log.innerHTML = "";
    (r.items || []).forEach(m => { const line = document.createElement("div"); line.textContent = new Date(m.ts).toLocaleTimeString() + " • " + (m.text || JSON.stringify(m)); log.appendChild(line); });
  };
}

/* Forms */
if (document.getElementById("btnForm")) {
  btnForm.onclick = async () => {
    const payload = { name: fname.value, email: femail.value, message: fmsg.value };
    const r = await api("/api/forms/submit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    flog.textContent = JSON.stringify(r, null, 2);
    fname.value = femail.value = fmsg.value = "";
  };
}

/* Upload (global example) */
if (document.getElementById("btnUpload")) {
  btnUpload.onclick = async () => {
    const file = document.getElementById("file").files?.[0];
    if (!file) return alert("Wybierz plik");
    const sign = await api("/api/storage/sign", { method:"POST", headers:{ "content-type":"application/json" }, body: JSON.stringify({ key: "uploads/" + file.name, contentType: file.type || "application/octet-stream" }) });
    if (!sign.ok) return ulog.textContent = JSON.stringify(sign, null, 2);
    const put = await fetch(sign.url, { method:"PUT", headers: { "content-type": file.type || "application/octet-stream" }, body: file });
    ulog.textContent = "Upload status: " + put.status + (put.ok ? "\nURL: " + sign.url.split('?')[0] : "");
  };
}

/* Metrics */
if (document.getElementById("btnMetrics")) {
  btnMetrics.onclick = async () => { const r = await api("/api/metrics"); metrics.textContent = JSON.stringify(r, null, 2); };
  btnMetrics.click();
}
