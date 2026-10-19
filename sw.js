// Service worker KasirKu: agar bisa dipasang & tampilan tetap terbuka saat sinyal lemah.
// Data transaksi tetap butuh internet (Supabase).
const CACHE='kasirku-v1';
const SHELL=['./','index.html','manifest.json','icon-192.png','icon-512.png'];
const HOSTS=['cdn.jsdelivr.net','fonts.googleapis.com','fonts.gstatic.com'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==CACHE).map(x=>caches.delete(x)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{
  const r=e.request,u=new URL(r.url);
  if(r.method!=='GET')return;
  if(u.origin!==location.origin&&!HOSTS.includes(u.hostname))return; // Supabase, peta, dll: langsung ke jaringan
  e.respondWith(fetch(r).then(res=>{const cp=res.clone();caches.open(CACHE).then(c=>c.put(r,cp));return res}).catch(()=>caches.match(r).then(m=>m||caches.match('index.html'))));
});
