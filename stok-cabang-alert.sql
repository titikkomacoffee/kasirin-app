-- KasirKu: PANTAUAN STOK CABANG + PUSAT = GUDANG (stok tidak terbatas)
-- Supabase > SQL Editor > New query > tempel SEMUA > Run
-- Syarat: multi-bisnis.sql dan update-stok-gaji.sql sudah dijalankan. Aman diulang.

-- 1) Batas stok menipis per produk / per bahan (opsional, kosong = pakai batas umum)
alter table public.products add column if not exists min_stock int;
alter table public.ingredients add column if not exists min_stock numeric;

-- 2) Pusat adalah gudang: stok Pusat tidak dikurangi / ditambah, hanya stok cabang yang dihitung
create or replace function public._adj(p_branch text, p_kind text, p_id uuid, p_delta numeric) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_branch is null then return; end if;
  if not exists (select 1 from public.branches where id::text = p_branch and business_id = public.my_business()) then return; end if;
  insert into public.branch_stock(branch_key, kind, item_id, qty, business_id)
    values (p_branch, p_kind, p_id, p_delta, public.my_business())
  on conflict (branch_key, kind, item_id) do update set qty = public.branch_stock.qty + excluded.qty;
end $$;

-- 3) Daftar stok cabang yang habis atau menipis.
--    Admin melihat semua cabang, Manager hanya cabangnya sendiri, peran lain tidak mendapat apa-apa.
--    Hanya barang yang pernah tercatat di cabang itu (kiriman, penjualan, atau stok awal) yang dipantau.
create or replace function public.stock_alerts() returns table(
  branch_id uuid, branch_name text, kind text, item_id uuid, item_name text, unit text,
  qty numeric, min_qty numeric, level text)
language sql stable security definer set search_path = public as $$
  with me as (
    select p.role::text as role, p.branch_id from public.profiles p where p.id = auth.uid() and coalesce(p.active, true)
  ),
  lp as (
    select coalesce(nullif((select value from public.settings where business_id = public.my_business() and key = 'low_prod'), ''), '5')::numeric as v
  ),
  base as (
    select b.id as branch_id, b.name::text as branch_name, s.kind::text as kind, s.item_id,
           (case when s.kind = 'produk' then pr.name else ig.name end)::text as item_name,
           (case when s.kind = 'produk' then 'pcs' else ig.unit end)::text as unit,
           s.qty,
           case when s.kind = 'produk' then coalesce(pr.min_stock, (select v from lp)) else coalesce(ig.min_stock, 0) end as min_qty
    from public.branch_stock s
    join public.branches b on b.id::text = s.branch_key and b.business_id = public.my_business()
    left join public.products pr on s.kind = 'produk' and pr.id = s.item_id and pr.stock is not null
    left join public.ingredients ig on s.kind = 'bahan' and ig.id = s.item_id
    where (s.kind = 'produk' and pr.id is not null) or (s.kind = 'bahan' and ig.id is not null)
  )
  select branch_id, branch_name, kind, item_id, item_name, unit, qty, min_qty,
         (case when qty <= 0 then 'habis' else 'menipis' end)::text
  from base
  where (qty <= 0 or qty <= min_qty)
    and ((select role from me) = 'admin' or ((select role from me) = 'manager' and branch_id = (select branch_id from me)))
  order by branch_name, (qty <= 0) desc, item_name
$$;
grant execute on function public.stock_alerts() to authenticated;

-- 4) Hasil: jumlah peringatan stok saat ini (dihitung untuk akun yang menjalankan; di SQL Editor biasanya 0)
select count(*) as peringatan_stok from public.stock_alerts();
