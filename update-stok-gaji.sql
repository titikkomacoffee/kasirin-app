-- Jalankan di Supabase > SQL Editor > New query > Run
-- Aman diulang. Jalankan SEBELUM mengunggah index.html yang baru.

-- 1) Stok dipisah per cabang (Pusat memakai stok utama produk/bahan, cabang memakai tabel ini)
create table if not exists public.branch_stock(
  branch_key text not null, kind text not null, item_id uuid not null, qty numeric default 0,
  primary key (branch_key, kind, item_id)
);
alter table public.branch_stock enable row level security;
drop policy if exists "bs_all" on public.branch_stock;
create policy "bs_all" on public.branch_stock for all to authenticated using (true) with check (true);

alter table public.transfers add column if not exists sent_applied boolean default false;
alter table public.transfers add column if not exists received_applied boolean default false;
alter table public.transfer_items add column if not exists item_id uuid;

-- 2) Potongan gaji karena setoran kurang
alter table public.shifts add column if not exists expected_cash numeric;
alter table public.shifts add column if not exists cash_sales numeric;
alter table public.shifts add column if not exists cash_expenses numeric;
alter table public.shifts add column if not exists diff numeric;
alter table public.shifts add column if not exists note text;
alter table public.shifts add column if not exists diff_waived boolean default false;

-- 3) Fungsi penyesuaian stok
create or replace function public._adj(p_branch text, p_kind text, p_id uuid, p_delta numeric) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_branch is null then
    if p_kind = 'produk' then
      update public.products set stock = stock + round(p_delta)::int where id = p_id and stock is not null;
    else
      update public.ingredients set stock = coalesce(stock,0) + p_delta where id = p_id;
    end if;
  else
    insert into public.branch_stock(branch_key, kind, item_id, qty) values (p_branch, p_kind, p_id, p_delta)
    on conflict (branch_key, kind, item_id) do update set qty = public.branch_stock.qty + excluded.qty;
  end if;
end $$;

create or replace function public._bkey(p_name text) returns text
language sql stable security definer set search_path = public as $$
  select case when lower(trim(coalesce(p_name,''))) = 'pusat' then null
         else (select id::text from public.branches where lower(trim(name)) = lower(trim(p_name)) limit 1) end
$$;

-- 4) Kirim: stok pengirim berkurang. Terima: stok penerima bertambah. (Hanya sekali per kiriman)
create or replace function public.apply_transfer(p_id uuid, p_phase text) returns void
language plpgsql security definer set search_path = public as $$
declare t public.transfers%rowtype; it record; nm text; bk text; sgn numeric; pid uuid; k text;
begin
  select * into t from public.transfers where id = p_id;
  if not found then return; end if;
  if p_phase = 'send' then
    if coalesce(t.sent_applied,false) then return; end if;
    nm := t.from_name; sgn := -1;
  else
    if coalesce(t.received_applied,false) then return; end if;
    nm := t.to_name; sgn := 1;
  end if;
  bk := public._bkey(nm);
  if bk is null and lower(trim(coalesce(nm,''))) <> 'pusat' then return; end if;
  for it in select * from public.transfer_items where transfer_id = p_id loop
    k := case when coalesce(it.item_type,'bahan') = 'produk' then 'produk' else 'bahan' end;
    pid := it.item_id;
    if pid is null then
      if k = 'produk' then
        select id into pid from public.products where lower(trim(name)) = lower(trim(it.name)) limit 1;
      else
        select id into pid from public.ingredients where lower(trim(name)) = lower(trim(it.name)) limit 1;
      end if;
    end if;
    if pid is not null then perform public._adj(bk, k, pid, sgn * it.qty); end if;
  end loop;
  if p_phase = 'send' then update public.transfers set sent_applied = true where id = p_id;
  else update public.transfers set received_applied = true where id = p_id; end if;
end $$;
grant execute on function public.apply_transfer(uuid, text) to authenticated;

-- 5) Penjualan & terbuang memotong stok sesuai cabang
drop function if exists public.sell_deduct(jsonb);
create or replace function public.sell_deduct(p_items jsonb, p_branch uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare it jsonb; r record; bk text := p_branch::text;
begin
  for it in select * from jsonb_array_elements(p_items) loop
    perform public._adj(bk, 'produk', (it->>'product_id')::uuid, -(it->>'qty')::numeric);
    for r in select ingredient_id, qty from public.product_ingredients where product_id = (it->>'product_id')::uuid loop
      perform public._adj(bk, 'bahan', r.ingredient_id, -(r.qty * (it->>'qty')::numeric));
    end loop;
  end loop;
end $$;
grant execute on function public.sell_deduct(jsonb, uuid) to authenticated;

drop function if exists public.waste_deduct(jsonb);
create or replace function public.waste_deduct(p_items jsonb, p_branch uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare it jsonb; r record; bk text := p_branch::text;
begin
  for it in select * from jsonb_array_elements(p_items) loop
    if it->>'kind' = 'minuman' then
      perform public._adj(bk, 'produk', (it->>'id')::uuid, -(it->>'qty')::numeric);
      for r in select ingredient_id, qty from public.product_ingredients where product_id = (it->>'id')::uuid loop
        perform public._adj(bk, 'bahan', r.ingredient_id, -(r.qty * (it->>'qty')::numeric));
      end loop;
    else
      perform public._adj(bk, 'bahan', (it->>'id')::uuid, -(it->>'qty')::numeric);
    end if;
  end loop;
end $$;
grant execute on function public.waste_deduct(jsonb, uuid) to authenticated;

-- 6) Terapkan kiriman lama (yang sudah tercatat sebelum update ini) ke stok.
--    Kiriman lama: stok pengirim dikurangi, dan kalau sudah "Diterima" stok penerima ditambah.
do $$ declare r record; begin
  for r in select id, status from public.transfers loop
    perform public.apply_transfer(r.id, 'send');
    if r.status = 'diterima' then perform public.apply_transfer(r.id, 'receive'); end if;
  end loop;
end $$;
