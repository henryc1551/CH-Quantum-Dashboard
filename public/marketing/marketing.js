btnTTAdv.onclick = async ()=>{
  const b = {
    start: ttStart.value.trim() || new Date(Date.now()-7*24*3600*1000).toISOString().slice(0,10),
    end: ttEnd.value.trim() || new Date().toISOString().slice(0,10)
  };
  const r = await fetch("/api/integrations/tiktok/ads/report-adv", {
    method:"POST", headers:{ "content-type":"application/json" }, body: JSON.stringify(b)
  }).then(x=>x.json());
  ttAdv.textContent = JSON.stringify(r, null, 2);
};
