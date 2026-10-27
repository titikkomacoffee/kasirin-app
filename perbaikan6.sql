-- Jalankan di Supabase > SQL Editor > New query > Run (cukup sekali)

-- Kirim produk jadi (selain bahan)
alter table public.transfer_items add column if not exists item_type text default 'bahan';

-- Cek apakah ada produk/bahan dobel (hasilnya tampil di tabel bawah)
select min(name) as produk_dobel, count(*) as jumlah from public.products group by lower(trim(name)) having count(*) > 1;
select min(name) as bahan_dobel, count(*) as jumlah from public.ingredients group by lower(trim(name)) having count(*) > 1;

-- Kunci agar nama tidak bisa dobel. Kalau masih ada yang dobel, kunci ditunda:
-- hapus yang dobel di menu Produk / Bahan Baku, lalu jalankan SQL ini sekali lagi.
do $$ begin
  if not exists (select 1 from public.products group by lower(trim(name)) having count(*) > 1) then
    create unique index if not exists products_name_uniq on public.products (lower(trim(name)));
  else
    raise notice 'Masih ada produk dobel - hapus dulu lalu jalankan ulang.';
  end if;
  if not exists (select 1 from public.ingredients group by lower(trim(name)) having count(*) > 1) then
    create unique index if not exists ingredients_name_uniq on public.ingredients (lower(trim(name)));
  else
    raise notice 'Masih ada bahan dobel - hapus dulu lalu jalankan ulang.';
  end if;
end $$;
