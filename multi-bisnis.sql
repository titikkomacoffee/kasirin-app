-- KasirKu: MULTI-BISNIS (data tiap bisnis terpisah) + denda absensi
-- Supabase > SQL Editor > New query > tempel SEMUA > Run
-- Aman diulang. JALANKAN SEBELUM mengunggah index.html yang baru.
-- Data yang sudah ada otomatis dimasukkan ke satu bisnis (bisnis Anda saat ini).

-- 1) Tabel bisnis dan kolom baru
create table if not exists public.businesses(
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text unique not null,
  created_at timestamptz default now()
);
alter table public.profiles add column if not exists business_id uuid references public.businesses(id);
alter table public.profiles add column if not exists start_date date;
alter table public.attendance add column if not exists late_min int default 0;
alter table public.attendance add column if not exists fine numeric default 0;
alter table public.shifts add column if not exists diff_waived boolean default false;

-- 2) Fungsi: bisnis milik pengguna yang sedang login
create or replace function public.my_business() returns uuid
language sql stable security definer set search_path = public as $$
  select business_id from public.profiles where id = auth.uid() and coalesce(active, true)
$$;
grant execute on function public.my_business() to authenticated;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.profiles where id = auth.uid() and role::text = 'admin' and coalesce(active, true))
$$;
create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.profiles where id = auth.uid() and role::text in ('admin','manager') and coalesce(active, true))
$$;

-- 3) Tabel pembebasan denda
create table if not exists public.fine_waivers(
  id uuid primary key default gen_random_uuid(),
  business_id uuid,
  user_id uuid not null,
  day date not null,
  created_at timestamptz default now(),
  unique (user_id, day)
);

-- 4) Masukkan data lama ke satu bisnis, lalu tambahkan business_id ke semua tabel
do $$
declare b uuid; nm text; c text; t text; fresh boolean;
begin
  select id into b from public.businesses order by created_at limit 1;
  fresh := (b is null);
  if fresh then
    begin
      execute 'select value from public.settings where key = ''store'' limit 1' into nm;
    exception when others then nm := null;
    end;
    loop
      c := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
      exit when not exists (select 1 from public.businesses where code = c);
    end loop;
    insert into public.businesses(name, code) values (coalesce(nullif(nm, ''), 'Bisnis Saya'), c) returning id into b;
  end if;

  foreach t in array array['branches','products','ingredients','product_ingredients','transactions','transaction_items',
                           'receivables','shifts','attendance','settings','cashbons','expenses','transfers','transfer_items',
                           'waste_logs','branch_stock','fine_waivers'] loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I add column if not exists business_id uuid', t);
      execute format('update public.%I set business_id = $1 where business_id is null', t) using b;
      execute format('create index if not exists %I on public.%I(business_id)', t || '_biz_idx', t);
      execute format('alter table public.%I alter column business_id set default public.my_business()', t);
    end if;
  end loop;

  if fresh then update public.profiles set business_id = b where business_id is null; end if;
  update public.profiles set start_date = current_date where start_date is null;
end $$;

-- 5) Pengaturan: satu set per bisnis
do $$ begin
  if not exists (
    select 1 from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
    where i.indrelid = 'public.settings'::regclass and i.indisprimary and a.attname = 'business_id'
  ) then
    alter table public.settings drop constraint if exists settings_pkey;
    alter table public.settings add primary key (business_id, key);
  end if;
end $$;

-- 6) Nama unik per bisnis (bukan se-aplikasi)
alter table public.transactions drop constraint if exists transactions_trx_key;
create unique index if not exists transactions_biz_trx on public.transactions(business_id, trx);
drop index if exists public.products_name_uniq;
drop index if exists public.ingredients_name_uniq;
do $$ begin
  if not exists (select 1 from public.products group by business_id, lower(trim(name)) having count(*) > 1) then
    create unique index if not exists products_biz_name_uniq on public.products(business_id, lower(trim(name)));
  else raise notice 'Masih ada produk dobel: hapus dulu lalu jalankan ulang.'; end if;
  if not exists (select 1 from public.ingredients group by business_id, lower(trim(name)) having count(*) > 1) then
    create unique index if not exists ingredients_biz_name_uniq on public.ingredients(business_id, lower(trim(name)));
  else raise notice 'Masih ada bahan dobel: hapus dulu lalu jalankan ulang.'; end if;
end $$;

-- 7) Pendaftaran: bisnis baru (jadi admin) atau gabung dengan kode (menunggu persetujuan admin)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  bn text := nullif(trim(m->>'biz_name'), '');
  jc text := nullif(trim(m->>'join_code'), '');
  nm text := coalesce(nullif(trim(m->>'full_name'), ''), split_part(new.email, '@', 1));
  b uuid; c text;
begin
  if bn is not null then
    loop
      c := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
      exit when not exists (select 1 from public.businesses where code = c);
    end loop;
    insert into public.businesses(name, code) values (bn, c) returning id into b;
    insert into public.profiles(id, name, role, active, business_id, start_date)
      values (new.id, nm, 'admin', true, b, current_date) on conflict (id) do nothing;
  elsif jc is not null then
    select id into b from public.businesses where lower(code) = lower(jc);
    if b is null then raise exception 'Kode bisnis tidak ditemukan'; end if;
    insert into public.profiles(id, name, role, active, business_id, start_date)
      values (new.id, nm, 'kasir', false, b, current_date) on conflict (id) do nothing;
  else
    insert into public.profiles(id, name, role, active) values (new.id, nm, 'kasir', false) on conflict (id) do nothing;
  end if;
  return new;
end $$;
drop trigger if exists on_signup on auth.users;
create trigger on_signup after insert on auth.users for each row execute function public.handle_new_user();

-- 8) Hapus anggota / ganti password: hanya admin, hanya untuk bisnis sendiri
create or replace function public.delete_member(uid uuid) returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if not public.is_admin() then raise exception 'Hanya admin yang boleh menghapus anggota'; end if;
  if uid = auth.uid() then raise exception 'Tidak bisa menghapus akun sendiri'; end if;
  if (select business_id from public.profiles where id = uid) is distinct from public.my_business() then
    raise exception 'Anggota bukan dari bisnis Anda';
  end if;
  delete from public.profiles where id = uid;
  delete from auth.users where id = uid;
end $$;
grant execute on function public.delete_member(uuid) to authenticated;

create or replace function public.set_member_password(uid uuid, pw text) returns void
language plpgsql security definer set search_path = public, auth, extensions as $$
begin
  if not public.is_admin() then raise exception 'Hanya admin yang boleh mengganti password'; end if;
  if length(pw) < 6 then raise exception 'Password minimal 6 karakter'; end if;
  if (select business_id from public.profiles where id = uid) is distinct from public.my_business() then
    raise exception 'Anggota bukan dari bisnis Anda';
  end if;
  update auth.users set encrypted_password = extensions.crypt(pw, extensions.gen_salt('bf')), updated_at = now() where id = uid;
end $$;
grant execute on function public.set_member_password(uuid, text) to authenticated;

-- 9) Stok & kiriman: hanya menyentuh data bisnis sendiri
create or replace function public._adj(p_branch text, p_kind text, p_id uuid, p_delta numeric) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_branch is null then
    if p_kind = 'produk' then
      update public.products set stock = stock + round(p_delta)::int
        where id = p_id and stock is not null and business_id = public.my_business();
    else
      update public.ingredients set stock = coalesce(stock, 0) + p_delta
        where id = p_id and business_id = public.my_business();
    end if;
  else
    if not exists (select 1 from public.branches where id::text = p_branch and business_id = public.my_business()) then return; end if;
    insert into public.branch_stock(branch_key, kind, item_id, qty, business_id)
      values (p_branch, p_kind, p_id, p_delta, public.my_business())
    on conflict (branch_key, kind, item_id) do update set qty = public.branch_stock.qty + excluded.qty;
  end if;
end $$;

create or replace function public._bkey(p_name text) returns text
language sql stable security definer set search_path = public as $$
  select case when lower(trim(coalesce(p_name, ''))) = 'pusat' then null
         else (select id::text from public.branches
               where business_id = public.my_business() and lower(trim(name)) = lower(trim(p_name)) limit 1) end
$$;

create or replace function public.apply_transfer(p_id uuid, p_phase text) returns void
language plpgsql security definer set search_path = public as $$
declare t public.transfers%rowtype; it record; nm text; bk text; sgn numeric; pid uuid; k text;
begin
  select * into t from public.transfers where id = p_id and business_id = public.my_business();
  if not found then return; end if;
  if p_phase = 'send' then
    if coalesce(t.sent_applied, false) then return; end if;
    nm := t.from_name; sgn := -1;
  else
    if coalesce(t.received_applied, false) then return; end if;
    nm := t.to_name; sgn := 1;
  end if;
  bk := public._bkey(nm);
  if bk is null and lower(trim(coalesce(nm, ''))) <> 'pusat' then return; end if;
  for it in select * from public.transfer_items where transfer_id = p_id loop
    k := case when coalesce(it.item_type, 'bahan') = 'produk' then 'produk' else 'bahan' end;
    pid := it.item_id;
    if pid is null then
      if k = 'produk' then
        select id into pid from public.products where business_id = public.my_business() and lower(trim(name)) = lower(trim(it.name)) limit 1;
      else
        select id into pid from public.ingredients where business_id = public.my_business() and lower(trim(name)) = lower(trim(it.name)) limit 1;
      end if;
    end if;
    if pid is not null then perform public._adj(bk, k, pid, sgn * it.qty); end if;
  end loop;
  if p_phase = 'send' then update public.transfers set sent_applied = true where id = p_id;
  else update public.transfers set received_applied = true where id = p_id; end if;
end $$;
grant execute on function public.apply_transfer(uuid, text) to authenticated;

-- 10) Keamanan: tiap pengguna hanya melihat data bisnisnya sendiri
do $$
declare t text; p record;
begin
  -- Semua anggota bisnis boleh baca & tulis
  foreach t in array array['branches','products','transactions','transaction_items','receivables','shifts','attendance',
                           'transfers','transfer_items','waste_logs','branch_stock','expenses'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy biz_all on public.%I for all to authenticated using (business_id = (select public.my_business())) with check (business_id = (select public.my_business()))', t);
  end loop;

  -- Semua anggota boleh baca; hanya Manager/Admin yang boleh mengubah
  foreach t in array array['ingredients','product_ingredients'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy biz_read on public.%I for select to authenticated using (business_id = (select public.my_business()))', t);
    execute format('create policy biz_staff on public.%I for all to authenticated using (business_id = (select public.my_business()) and public.is_staff()) with check (business_id = (select public.my_business()) and public.is_staff())', t);
  end loop;

  -- Semua anggota boleh baca; hanya Admin yang boleh mengubah (setelan, denda, kas bon)
  foreach t in array array['settings','cashbons','fine_waivers'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy biz_read on public.%I for select to authenticated using (business_id = (select public.my_business()))', t);
    execute format('create policy biz_admin on public.%I for all to authenticated using (business_id = (select public.my_business()) and public.is_admin()) with check (business_id = (select public.my_business()) and public.is_admin())', t);
  end loop;

  -- Profil anggota
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'profiles' loop
    execute format('drop policy %I on public.profiles', p.policyname);
  end loop;
  alter table public.profiles enable row level security;
  create policy p_read on public.profiles for select to authenticated
    using (business_id = (select public.my_business()) or id = auth.uid());
  create policy p_admin on public.profiles for all to authenticated
    using (public.is_admin() and business_id = (select public.my_business()))
    with check (public.is_admin() and business_id = (select public.my_business()));

  -- Data bisnis
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'businesses' loop
    execute format('drop policy %I on public.businesses', p.policyname);
  end loop;
  alter table public.businesses enable row level security;
  create policy b_read on public.businesses for select to authenticated using (id = (select public.my_business()));
  create policy b_admin on public.businesses for update to authenticated
    using (public.is_admin() and id = (select public.my_business()))
    with check (public.is_admin() and id = (select public.my_business()));
end $$;

grant select, insert, update, delete on public.businesses, public.fine_waivers to authenticated;

-- 11) Hasil: daftar bisnis yang ada (kode dipakai karyawan untuk bergabung)
select name as bisnis, code as kode_bisnis from public.businesses order by created_at;
