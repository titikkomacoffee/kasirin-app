// Service worker KasirKu: agar bisa dipasang & tetap terbuka saat server hosting bermasalah.
// Offline: aplikasi terbuka dari cache; penjualan disimpan di antrean perangkat dan dikirim saat online.
// v2: halaman error server (5xx) TIDAK lagi disimpan/ditampilkan menggantikan aplikasi.
const CACHE='kasirku-v4';
const SHELL=['./','index.html','manifest.json','icon-192.png','icon-512.png','https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js'];
const HOSTS=['cdn.jsdelivr.net','fonts.googleapis.com','fonts.gstatic.com'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>Promise.all(SHELL.map(u=>c.add(u).catch(()=>{})))).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==CACHE).map(x=>caches.delete(x)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{
  const r=e.request,u=new URL(r.url);
  if(r.method!=='GET')return;
  if(u.origin!==location.origin&&!HOSTS.includes(u.hostname))return; // Supabase, peta, dll: langsung ke jaringan
  const cached=()=>caches.match(r,{ignoreSearch:true}).then(m=>m||(r.mode==='navigate'?caches.match('index.html'):undefined));
  e.respondWith(fetch(r).then(res=>{
    if(res.ok||res.type==='opaque'){const cp=res.clone();caches.open(CACHE).then(c=>c.put(r,cp));return res}
    if(res.status>=500)return cached().then(m=>m||res); // server error: pakai salinan tersimpan kalau ada
    return res;
  }).catch(()=>cached().then(m=>m||Response.error())));
});
