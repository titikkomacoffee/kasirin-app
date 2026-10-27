KASIRKU - PAKET LENGKAP
=======================

ISI PAKET
  web/  -> file aplikasi. Upload SEMUA ke folder public_html di hosting
           (atau ke repository GitHub Pages), menimpa file lama.
  sql/  -> file database untuk Supabase (SQL Editor > New query > tempel > Run).

CARA MEMASANG VERSI TERBARU (proyek Anda yang sudah berjalan)
  1. Jalankan sql/langganan.sql di Supabase.
     Syarat: multi-bisnis.sql dan admin-platform.sql sudah pernah dijalankan.
     (Jika piutang-bayar.sql dan stok-cabang-alert.sql belum dijalankan, jalankan keduanya dulu.)
  2. Upload semua isi folder web/ ke public_html.
  3. Tutup aplikasi sepenuhnya di HP, lalu buka lagi.

URUTAN SQL SESUAI RIWAYAT PROYEK
   1. supabase.sql              database awal
   2. perbaikan.sql ... perbaikan6.sql   perbaikan bertahap awal (sebagian sudah digantikan file berikutnya)
   3. langkah1-peran.sql        tambah pilihan peran (jalankan sendiri dulu)
   4. semua-perbaikan.sql       gabungan perbaikan
   5. tim-anggota.sql           hapus anggota & reset password
   6. pengeluaran.sql           pengeluaran & rekonsiliasi kas
   7. update-stok-gaji.sql      stok per cabang & potongan setoran kurang
   8. multi-bisnis.sql          banyak bisnis, denda absensi
   9. admin-platform.sql        admin platform (GANTI email di dalam file dengan email Anda)
  10. piutang-bayar.sql         pembayaran piutang
  11. stok-cabang-alert.sql     peringatan stok cabang, Pusat = gudang
  12. langganan.sql             LANGGANAN (demo 1 bulan, paket berbayar)

CATATAN
  - Urutan di atas mengikuti riwayat proyek Anda. Pemasangan dari nol belum diuji
    penuh; untuk proyek baru, minta bantuan sebelum menjalankannya.
  - Jangan unggah file kunci (keystore) atau kata sandi apa pun ke public_html.
  - Kontak developer di aplikasi: WhatsApp 628811533903.

LANGGANAN
  - Bisnis baru: demo gratis (bawaan 30 hari, bisa diubah developer).
  - Paket awal: 1 bulan Rp10.000, 6 bulan Rp50.000, 12 bulan Rp100.000.
  - Developer (akun admin platform) gratis. Harga paket, lama demo, info pembayaran,
    dan nomor WhatsApp diatur di aplikasi: Lainnya > Setelan > Buka Admin Platform >
    Pengaturan langganan.
