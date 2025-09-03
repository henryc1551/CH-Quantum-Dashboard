async function jget(u){ const r=await fetch(u); return r.json(); }
async function jpost(u,b){ const r=await fetch(u,{method:"POST",headers:{ "content-type":"application/json" },body:JSON.stringify(b)}); return r.json(); }

btnCreate.onclick = async ()=>{
  const r = await jpost("/api/projects/create", { name: pname.value.trim() });
  createLog.textContent = JSON.stringify(r, null, 2);
  if (r.ok) { pid.value = r.project.id; }
};

btnSign.onclick = async ()=>{
  const f = pfile.files?.[0]; if (!f) { upLog.textContent = "Wybierz plik"; return; }
  const id = pid.value.trim(); if (!id) { upLog.textContent = "Podaj ID projektu"; return; }
  const r = await jpost("/api/projects/sign-upload", { id, filename: f.name, contentType: f.type || "application/octet-stream" });
  if (!r.ok) { upLog.textContent = JSON.stringify(r, null, 2); return; }
  const put = await fetch(r.putUrl, { method:"PUT", headers: { "content-type": f.type || "application/octet-stream" }, body: f });
  upLog.textContent = "Upload: " + put.status + (put.ok ? `\nPreview: ${location.origin}${r.previewUrl}`:"");
  if (put.ok) { previewPath.value = r.previewUrl; }
};

btnList.onclick = async ()=>{
  const r = await jget("/api/projects/list");
  plist.textContent = JSON.stringify(r, null, 2);
};
btnList.click();

btnPreview.onclick = ()=>{
  const p = previewPath.value.trim();
  if (!p) return;
  frame.src = p;
};
