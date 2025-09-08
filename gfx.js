// gfx.js — kontroler presetów grafiki
export const GFX = (()=>{

  const canWebGPU = typeof navigator !== "undefined" && "gpu" in navigator;

  function getUserId(){
    try{
      let id = localStorage.getItem("qdp-user-id");
      if(!id){
        id = "u-" + ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c=>(c^crypto.getRandomValues(new Uint8Array(1))[0]&15>>c/4).toString(16));
        localStorage.setItem("qdp-user-id", id);
      }
      return id;
    }catch{ return null; }
  }

  async function getPreset(){
    const id = getUserId();
    const r1 = await fetch(`/api/gfx/get?id=${encodeURIComponent(id)}`).then(r=>r.json()).catch(()=>null);
    if (r1 && r1.ok && r1.preset) return normalize(r1.preset);
    const r2 = await fetch(`/api/gfx/get`).then(r=>r.json()).catch(()=>null);
    if (r2 && r2.ok && r2.preset) return normalize(r2.preset);
    return "high";
  }

  function normalize(p){
    p = String(p||"high").toLowerCase();
    if (p === "ultra-rt" && !canWebGPU) return "high";
    const allowed = new Set(["mobile","high","ultra-rt"]);
    return allowed.has(p) ? p : "high";
  }

  function getEngineSettings(preset){
    preset = normalize(preset);
    if (preset === "mobile") {
      return { textures:"low", shadows:"off", pathTracing:false };
    }
    if (preset === "ultra-rt") {
      return { textures:"ultra", shadows:"rt", pathTracing:true };
    }
    return { textures:"high", shadows:"soft", pathTracing:false };
  }

  return { canWebGPU, getUserId, getPreset, getEngineSettings };
})();
