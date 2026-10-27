-- KasirKu: ADMIN PLATFORM (pemilik aplikasi)
-- Supabase > SQL Editor > New query > tempel SEMUA > Run
-- Syarat: multi-bisnis.sql sudah dijalankan. Aman diulang.

-- 1) Status bisnis (aktif / dinonaktifkan)
alter table public.businesses add column if not exists active boolean default true;
update public.businesses set active = true where active is null;

-- 2) Daftar admin platform. Tabel ini TIDAK bisa diakses dari aplikasi, hanya lewat fungsi di bawah.
create table if not exists public.platform_admins(
  user_id uuid primary key,
  created_at timestamptz default now()
);
alter table public.platform_admins enable row level security;
revoke all on public.platform_admins from anon, authenticated;

create or replace function public.platform_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.platform_admins where user_id = auth.uid())
$$;
grant execute on function public.platform_is_admin() to authenticated;

-- 3) Bisnis yang dinonaktifkan: semua anggotanya langsung tidak punya akses data
create or replace function public.my_business() returns uuid
language sql stable security definer set search_path = public as $$
  select p.business_id
  from public.profiles p join public.businesses b on b.id = p.business_id
  where p.id = auth.uid() and coalesce(p.active, true) and coalesce(b.active, true)
$$;

-- 4) Ringkasan semua bisnis (hanya angka ringkas, bukan isi transaksi)
create or replace function public.platform_overview() returns table(
  id uuid, name text, code text, active boolean, created_at timestamptz,
  owner_name text, owner_email text, members int, branches int, products int,
  trx_total bigint, trx_month bigint, omzet_month numeric, omzet_total numeric, last_trx timestamptz)
language sql stable security definer set search_path = public, auth as $$
  select b.id, b.name::text, b.code::text, coalesce(b.active, true), b.created_at,
    (select p.name::text from public.profiles p where p.business_id = b.id and p.role::text = 'admin' order by p.start_date nulls last limit 1),
    (select u.email::text from public.profiles p join auth.users u on u.id = p.id where p.business_id = b.id and p.role::text = 'admin' order by p.start_date nulls last limit 1),
    (select count(*)::int from public.profiles p where p.business_id = b.id and coalesce(p.active, true)),
    (select count(*)::int from public.branches x where x.business_id = b.id),
    (select count(*)::int from public.products x where x.business_id = b.id),
    (select count(*) from public.transactions t where t.business_id = b.id),
    (select count(*) from public.transactions t where t.business_id = b.id and t.created_at >= date_trunc('month', now())),
    (select coalesce(sum(t.total), 0) from public.transactions t where t.business_id = b.id and t.created_at >= date_trunc('month', now())),
    (select coalesce(sum(t.total), 0) from public.transactions t where t.business_id = b.id),
    (select max(t.created_at) from public.transactions t where t.business_id = b.id)
  from public.businesses b
  where public.platform_is_admin()
  order by b.created_at
$$;
grant execute on function public.platform_overview() to authenticated;

-- 5) Daftar akun dalam satu bisnis
create or replace function public.platform_members(p_biz uuid) returns table(
  user_id uuid, name text, email text, role text, active boolean)
language sql stable security definer set search_path = public, auth as $$
  select p.id, p.name::text, u.email::text, p.role::text, coalesce(p.active, true)
  from public.profiles p left join auth.users u on u.id = p.id
  where p.business_id = p_biz and public.platform_is_admin()
  order by (p.role::text = 'admin') desc, p.name
$$;
grant execute on function public.platform_members(uuid) to authenticated;

-- 6) Aktifkan / nonaktifkan bisnis
create or replace function public.platform_set_active(p_biz uuid, p_active boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.platform_is_admin() then raise exception 'Bukan admin platform'; end if;
  if not p_active and p_biz = (select business_id from public.profiles where id = auth.uid()) then
    raise exception 'Tidak bisa menonaktifkan bisnis Anda sendiri';
  end if;
  update public.businesses set active = p_active where id = p_biz;
end $$;
grant execute on function public.platform_set_active(uuid, boolean) to authenticated;

-- 7) Reset password akun mana pun (untuk bantuan saat lupa password)
create or replace function public.platform_set_password(uid uuid, pw text) returns void
language plpgsql security definer set search_path = public, auth, extensions as $$
begin
  if not public.platform_is_admin() then raise exception 'Bukan admin platform'; end if;
  if length(pw) < 6 then raise exception 'Password minimal 6 karakter'; end if;
  update auth.users set encrypted_password = extensions.crypt(pw, extensions.gen_salt('bf')), updated_at = now() where id = uid;
end $$;
grant execute on function public.platform_set_password(uuid, text) to authenticated;

-- 8) Hapus bisnis beserta SEMUA datanya dan akun anggotanya (permanen)
create or replace function public.platform_delete_business(p_biz uuid) returns void
language plpgsql security definer set search_path = public, auth as $$
declare t text; ids uuid[];
begin
  if not public.platform_is_admin() then raise exception 'Bukan admin platform'; end if;
  if p_biz = (select business_id from public.profiles where id = auth.uid()) then
    raise exception 'Tidak bisa menghapus bisnis Anda sendiri';
  end if;
  if exists (select 1 from public.profiles p join public.platform_admins a on a.user_id = p.id where p.business_id = p_biz) then
    raise exception 'Bisnis ini memuat akun admin platform';
  end if;
  select array_agg(id) into ids from public.profiles where business_id = p_biz;
  foreach t in array array['transaction_items','receivables','transactions','shifts','attendance','cashbons','expenses',
                           'fine_waivers','waste_logs','transfer_items','transfers','branch_stock','product_ingredients',
                           'products','ingredients','settings'] loop
    if to_regclass('public.' || t) is not null then
      execute format('delete from public.%I where business_id = $1', t) using p_biz;
    end if;
  end loop;
  delete from public.profiles where business_id = p_biz;
  delete from public.branches where business_id = p_biz;
  if ids is not null then delete from auth.users where id = any(ids); end if;
  delete from public.businesses where id = p_biz;
end $$;
grant execute on function public.platform_delete_business(uuid) to authenticated;

-- 9) >>> GANTI email di bawah dengan email login Anda sebagai pemilik aplikasi <<<
--    (contoh: admin@kasir.id). Untuk admin platform tambahan, salin blok ini dengan email lain.
insert into public.platform_admins(user_id)
select id from auth.users where lower(email) = lower('admin@kasir.id')
on conflict do nothing;

-- 10) Hasil: daftar admin platform saat ini (kosong = email di atas belum cocok)
select u.email as admin_platform from public.platform_admins a join auth.users u on u.id = a.user_id;
