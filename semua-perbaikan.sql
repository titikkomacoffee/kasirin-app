-- KasirKu: SQL gabungan. Aman dijalankan berulang kali (yang sudah ada dilewati).
-- LANGKAH 2 (jalankan setelah langkah1-peran.sql berhasil)
-- Supabase > SQL Editor > New query > tempel semua > Run

-- 1) Pendaftaran akun (akun pertama = admin)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare r text;
begin
  r := case when (select count(*) from public.profiles)=0 then 'admin' else 'kasir' end;
  execute format('insert into public.profiles(id,name,role) values (%L,%L,%L) on conflict (id) do nothing',
                 new.id, split_part(new.email,'@',1), r);
  return new;
end $$;
drop trigger if exists on_signup on auth.users;
create trigger on_signup after insert on auth.users for each row execute function public.handle_new_user();

-- 2) Kolom gaji
alter table public.profiles add column if not exists base_salary numeric default 0;
alter table public.profiles add column if not exists bonus_per_item numeric default 0;
alter table public.profiles add column if not exists meal_allowance numeric default 0;

-- 3) Fungsi hak akses
create or replace function public.is_admin() returns boolean
language sql security definer set search_path = public stable as $$
  select exists(select 1 from public.profiles where id = auth.uid() and role::text = 'admin')
$$;
create or replace function public.is_staff() returns boolean
language sql security definer set search_path = public stable as $$
  select exists(select 1 from public.profiles where id = auth.uid() and role::text in ('admin','manager'))
$$;

drop policy if exists "auth_all" on public.profiles;
drop policy if exists "profiles_read" on public.profiles;
drop policy if exists "profiles_admin_write" on public.profiles;
create policy "profiles_read" on public.profiles for select to authenticated using (true);
create policy "profiles_admin_write" on public.profiles for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- 4) Tabel-tabel baru
create table if not exists public.cashbons(id uuid primary key default gen_random_uuid(), user_id uuid, amount numeric, note text, created_at timestamptz default now());
create table if not exists public.ingredients(id uuid primary key default gen_random_uuid(), name text not null, unit text default 'gram', stock numeric default 0, created_at timestamptz default now());
create table if not exists public.transfers(id uuid primary key default gen_random_uuid(), from_name text, to_name text, created_by uuid, by_name text, created_at timestamptz default now());
create table if not exists public.transfer_items(id uuid primary key default gen_random_uuid(), transfer_id uuid references public.transfers on delete cascade, name text, unit text, qty numeric);
create table if not exists public.product_ingredients(id uuid primary key default gen_random_uuid(), product_id uuid references public.products on delete cascade, ingredient_id uuid references public.ingredients on delete cascade, qty numeric not null);
create table if not exists public.waste_logs(id uuid primary key default gen_random_uuid(), kind text, ref_id uuid, name text, unit text, qty numeric, reason text, note text, by_id uuid, by_name text, created_at timestamptz default now());

alter table public.ingredients add column if not exists stock numeric default 0;
alter table public.transfers add column if not exists kind text default 'kirim';
alter table public.transfers add column if not exists status text default 'dikirim';
alter table public.transfers add column if not exists received_by text;
alter table public.transfers add column if not exists received_at timestamptz;
alter table public.transfer_items add column if not exists item_type text default 'bahan';

-- 5) Keamanan tabel
alter table public.cashbons enable row level security;
alter table public.ingredients enable row level security;
alter table public.transfers enable row level security;
alter table public.transfer_items enable row level security;
alter table public.product_ingredients enable row level security;
alter table public.waste_logs enable row level security;

drop policy if exists "cashbons_read" on public.cashbons;
drop policy if exists "cashbons_admin" on public.cashbons;
create policy "cashbons_read" on public.cashbons for select to authenticated using (true);
create policy "cashbons_admin" on public.cashbons for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "ing_read" on public.ingredients;
drop policy if exists "ing_staff" on public.ingredients;
create policy "ing_read" on public.ingredients for select to authenticated using (true);
create policy "ing_staff" on public.ingredients for all to authenticated using (public.is_staff()) with check (public.is_staff());

drop policy if exists "pi_read" on public.product_ingredients;
drop policy if exists "pi_staff" on public.product_ingredients;
create policy "pi_read" on public.product_ingredients for select to authenticated using (true);
create policy "pi_staff" on public.product_ingredients for all to authenticated using (public.is_staff()) with check (public.is_staff());

drop policy if exists "tr_all" on public.transfers;
drop policy if exists "tri_all" on public.transfer_items;
drop policy if exists "waste_all" on public.waste_logs;
create policy "tr_all" on public.transfers for all to authenticated using (true) with check (true);
create policy "tri_all" on public.transfer_items for all to authenticated using (true) with check (true);
create policy "waste_all" on public.waste_logs for all to authenticated using (true) with check (true);

-- 6) Stok otomatis saat jual dan saat ada yang terbuang
create or replace function public.sell_deduct(p_items jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare it jsonb;
begin
  for it in select * from jsonb_array_elements(p_items) loop
    update public.products set stock = stock - (it->>'qty')::int
      where id = (it->>'product_id')::uuid and stock is not null;
    update public.ingredients g set stock = coalesce(g.stock,0) - pi.qty * (it->>'qty')::numeric
      from public.product_ingredients pi
      where pi.ingredient_id = g.id and pi.product_id = (it->>'product_id')::uuid;
  end loop;
end $$;
grant execute on function public.sell_deduct(jsonb) to authenticated;

create or replace function public.waste_deduct(p_items jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare it jsonb;
begin
  for it in select * from jsonb_array_elements(p_items) loop
    if it->>'kind' = 'minuman' then
      update public.products set stock = stock - round((it->>'qty')::numeric)::int
        where id = (it->>'id')::uuid and stock is not null;
      update public.ingredients g set stock = coalesce(g.stock,0) - pi.qty * (it->>'qty')::numeric
        from public.product_ingredients pi
        where pi.ingredient_id = g.id and pi.product_id = (it->>'id')::uuid;
    else
      update public.ingredients set stock = coalesce(stock,0) - (it->>'qty')::numeric
        where id = (it->>'id')::uuid;
    end if;
  end loop;
end $$;
grant execute on function public.waste_deduct(jsonb) to authenticated;

-- 7) Kunci anti dobel (ditunda otomatis kalau masih ada nama kembar)
do $$ begin
  if not exists (select 1 from public.products group by lower(trim(name)) having count(*) > 1) then
    create unique index if not exists products_name_uniq on public.products (lower(trim(name)));
  else
    raise notice 'Masih ada produk dobel - hapus dulu di menu Produk lalu jalankan ulang.';
  end if;
  if not exists (select 1 from public.ingredients group by lower(trim(name)) having count(*) > 1) then
    create unique index if not exists ingredients_name_uniq on public.ingredients (lower(trim(name)));
  else
    raise notice 'Masih ada bahan dobel - hapus dulu di menu Bahan Baku lalu jalankan ulang.';
  end if;
end $$;

-- 8) Hasil akhir: daftar produk dobel (kosong = aman)
select min(name) as produk_dobel, count(*) as jumlah from public.products group by lower(trim(name)) having count(*) > 1;
