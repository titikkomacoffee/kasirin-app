/*
 * Service worker minimal untuk Kasirin.
 * Tujuannya HANYA supaya browser mengizinkan "Instal Aplikasi" / Add to
 * Home Screen di Android (itu mensyaratkan ada service worker terdaftar).
 *
 * Ini SENGAJA tidak melakukan cache data bisnis (transaksi, stok, dll) —
 * data itu harus selalu diambil langsung dari Supabase supaya tidak ada
 * versi basi/keliru yang ketahan di cache. Yang di-cache hanya file
 * "cangkang" aplikasi (HTML/ikon) supaya proses buka aplikasinya cepat.
 */
const CACHE_NAME = 'kasirin-shell-v1';
const SHELL_FILES = ['./index.html', './manifest.json', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).catch(()=>{})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Strategi: selalu coba ambil dari jaringan dulu (data terbaru), baru
// fallback ke cache kalau benar-benar offline. Ini bukan mode offline
// penuh — aplikasi tetap butuh koneksi untuk sinkron data bisnis.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const resClone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, resClone)).catch(()=>{});
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
