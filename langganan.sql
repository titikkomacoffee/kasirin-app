-- KasirKu: LANGGANAN (demo 1 bulan, lalu berlangganan; akun developer tetap gratis)
-- Supabase > SQL Editor > New query > tempel SEMUA > Run
-- Syarat: multi-bisnis.sql dan admin-platform.sql sudah dijalankan. Aman diulang.
-- Harga awal: 1 bulan Rp10.000 | 6 bulan Rp50.000 | 12 bulan Rp100.000 (bisa diubah developer di aplikasi).

-- 1) Kolom langganan pada bisnis
alter table public.businesses add column if not exists trial_ends_at timestamptz default (now() + interval '1 month');
alter table public.businesses add column if not exists paid_until timestamptz;
alter table public.businesses add column if not exists exempt boolean default false;
update public.businesses set trial_ends_at = now() + interval '1 month' where trial_ends_at is null;

-- Bisnis yang berisi akun developer (admin platform) otomatis gratis
update public.businesses b set exempt = true
where exists (select 1 from public.profiles p join public.platform_admins a on a.user_id = p.id where p.business_id = b.id);

-- 2) Tabel paket, pengaturan developer, dan pembayaran
create table if not exists public.plans(
  code text primary key, name text not null, months int not null, price numeric not null, active boolean default true
);
insert into public.plans(code, name, months, price) values
  ('m1', '1 bulan', 1, 10000), ('m6', '6 bulan', 6, 50000), ('m12', '12 bulan', 12, 100000)
on conflict (code) do nothing;

create table if not exists public.platform_settings(key text primary key, value text);

create table if not exists public.subscription_payments(
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  plan text, months int, amount numeric,
  proof_url text,
  status text default 'pending',
  note text,
  requested_by uuid, requested_by_name text,
  created_at timestamptz default now(),
  reviewed_at timestamptz, reviewed_by uuid
);
create index if not exists subscription_payments_biz_idx on public.subscription_payments(business_id);

-- Keamanan tabel: paket & info pembayaran hanya bisa dibaca; pembayaran hanya lewat fungsi di bawah
alter table public.plans enable row level security;
alter table public.platform_settings enable row level security;
alter table public.subscription_payments enable row level security;
drop policy if exists plans_read on public.plans;
create policy plans_read on public.plans for select to authenticated using (true);
drop policy if exists pset_read on public.platform_settings;
create policy pset_read on public.platform_settings for select to authenticated using (true);
revoke all on public.plans, public.platform_settings, public.subscription_payments from anon, authenticated;
grant select on public.plans, public.platform_settings to authenticated;

-- Admin bisnis hanya boleh mengubah NAMA bisnis (bukan masa langganan)
revoke insert, update, delete on public.businesses from anon, authenticated;
grant update (name) on public.businesses to authenticated;

-- 3) Masa demo bisnis baru mengikuti pengaturan developer (bawaan 30 hari)
create or replace function public.biz_trial_default() returns trigger
language plpgsql security definer set search_path = public as $$
declare d int;
begin
  select nullif(value, '')::int into d from public.platform_settings where key = 'trial_days';
  new.trial_ends_at := now() + make_interval(days => coalesce(d, 30));
  return new;
end $$;
drop trigger if exists biz_trial on public.businesses;
create trigger biz_trial before insert on public.businesses for each row execute function public.biz_trial_default();

-- 4) Status langganan sebuah bisnis: gratis | aktif | trial | berakhir | nonaktif
create or replace function public.biz_sub_status(p_biz uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when b.id is null then 'tidak ada'
    when coalesce(b.active, true) = false then 'nonaktif'
    when coalesce(b.exempt, false) then 'gratis'
    when b.paid_until is not null and b.paid_until > now() then 'aktif'
    when b.trial_ends_at is not null and b.trial_ends_at > now() then 'trial'
    else 'berakhir' end
  from (select 1) x left join public.businesses b on b.id = p_biz
$$;

-- 5) Bisnis yang masa langgananannya habis tidak bisa membaca/menulis data (data tetap tersimpan)
create or replace function public.my_business() returns uuid
language sql stable security definer set search_path = public as $$
  select p.business_id
  from public.profiles p join public.businesses b on b.id = p.business_id
  where p.id = auth.uid() and coalesce(p.active, true)
    and public.biz_sub_status(b.id) in ('gratis', 'aktif', 'trial')
$$;

-- 6) Info langganan untuk aplikasi (tetap bisa dibaca walau sudah berakhir)
create or replace function public.my_subscription() returns table(
  business_id uuid, business_name text, status text, valid_until timestamptz, days_left int,
  exempt boolean, is_admin boolean, pending int)
language sql stable security definer set search_path = public as $$
  select b.id, b.name::text, public.biz_sub_status(b.id),
         case when coalesce(b.exempt, false) then null else greatest(b.paid_until, b.trial_ends_at) end,
         case when coalesce(b.exempt, false) then null
              else greatest(0, ceil(extract(epoch from (coalesce(greatest(b.paid_until, b.trial_ends_at), now()) - now())) / 86400))::int end,
         coalesce(b.exempt, false), (p.role::text = 'admin'),
         (select count(*)::int from public.subscription_payments sp where sp.business_id = b.id and sp.status = 'pending')
  from public.profiles p join public.businesses b on b.id = p.business_id
  where p.id = auth.uid() and coalesce(p.active, true)
$$;
grant execute on function public.my_subscription() to authenticated;

create or replace function public.my_payments() returns table(
  id uuid, plan text, months int, amount numeric, status text, note text, created_at timestamptz, proof_url text)
language sql stable security definer set search_path = public as $$
  select sp.id, sp.plan::text, sp.months, sp.amount, sp.status::text, sp.note::text, sp.created_at, sp.proof_url::text
  from public.subscription_payments sp join public.profiles p on p.business_id = sp.business_id
  where p.id = auth.uid() and coalesce(p.active, true) and p.role::text = 'admin'
  order by sp.created_at desc limit 20
$$;
grant execute on function public.my_payments() to authenticated;

-- 7) Admin bisnis mengirim bukti pembayaran (nominal dihitung server dari tabel paket)
create or replace function public.subscribe_request(p_plan text, p_proof text) returns uuid
language plpgsql security definer set search_path = public as $$
declare pr public.profiles%rowtype; pl public.plans%rowtype; nid uuid;
begin
  select * into pr from public.profiles where id = auth.uid() and coalesce(active, true);
  if not found or pr.business_id is null then raise exception 'Akun tidak terhubung ke bisnis'; end if;
  if pr.role::text <> 'admin' then raise exception 'Hanya admin bisnis yang bisa berlangganan'; end if;
  select * into pl from public.plans where code = p_plan and coalesce(active, true);
  if not found then raise exception 'Paket tidak ditemukan'; end if;
  if coalesce(p_proof, '') = '' then raise exception 'Bukti pembayaran wajib diunggah'; end if;
  if exists (select 1 from public.subscription_payments where business_id = pr.business_id and status = 'pending') then
    raise exception 'Masih ada pembayaran yang menunggu konfirmasi';
  end if;
  insert into public.subscription_payments(business_id, plan, months, amount, proof_url, requested_by, requested_by_name)
    values (pr.business_id, pl.code, pl.months, pl.price, p_proof, pr.id, pr.name) returning id into nid;
  return nid;
end $$;
grant execute on function public.subscribe_request(text, text) to authenticated;

-- 8) Fungsi developer (admin platform)
drop function if exists public.platform_overview();
create function public.platform_overview() returns table(
  id uuid, name text, code text, active boolean, created_at timestamptz,
  owner_name text, owner_email text, members int, branches int, products int,
  trx_total bigint, trx_month bigint, omzet_month numeric, omzet_total numeric, last_trx timestamptz,
  trial_ends_at timestamptz, paid_until timestamptz, exempt boolean, sub_status text, pending int)
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
    (select max(t.created_at) from public.transactions t where t.business_id = b.id),
    b.trial_ends_at, b.paid_until, coalesce(b.exempt, false), public.biz_sub_status(b.id),
    (select count(*)::int from public.subscription_payments sp where sp.business_id = b.id and sp.status = 'pending')
  from public.businesses b
  where public.platform_is_admin()
  order by b.created_at
$$;
grant execute on function public.platform_overview() to authenticated;

create or replace function public.platform_payments() returns table(
  id uuid, business_id uuid, business_name text, plan text, months int, amount numeric,
  proof_url text, status text, note text, created_at timestamptz, requested_by_name text)
language sql stable security definer set search_path = public as $$
  select sp.id, sp.business_id, b.name::text, sp.plan::text, sp.months, sp.amount, sp.proof_url::text,
         sp.status::text, sp.note::text, sp.created_at, sp.requested_by_name::text
  from public.subscription_payments sp join public.businesses b on b.id = sp.business_id
  where public.platform_is_admin()
  order by (sp.status = 'pending') desc, sp.created_at desc limit 60
$$;
grant execute on function public.platform_payments() to authenticated;

create or replace function public.platform_review_payment(p_id uuid, p_ok boolean, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare r public.subscription_payments%rowtype; base timestamptz;
begin
  if not public.platform_is_admin() then raise exception 'Bukan admin platform'; end if;
  select * into r from public.subscription_payments where id = p_id for update;
  if not found or r.status <> 'pending' then raise exception 'Pembayaran tidak ditemukan atau sudah diproses'; end if;
  if p_ok then
    select greatest(now(), coalesce(paid_until, now()), coalesce(trial_ends_at, now())) into base from public.businesses where id = r.business_id;
    update public.businesses set paid_until = base + (r.months || ' months')::interval where id = r.business_id;
    update public.subscription_payments set status = 'approved', reviewed_at = now(), reviewed_by = auth.uid(), note = nullif(p_note, '') where id = p_id;
  else
    update public.subscription_payments set status = 'rejected', reviewed_at = now(), reviewed_by = auth.uid(), note = nullif(p_note, '') where id = p_id;
  end if;
end $$;
grant execute on function public.platform_review_payment(uuid, boolean, text) to authenticated;

create or replace function public.platform_extend(p_biz uuid, p_months int) returns void
language plpgsql security definer set search_path = public as $$
declare base timestamptz;
begin
  if not public.platform_is_admin() then raise exception 'Bukan admin platform'; end if;
  if p_months < 1 then raise exception 'Jumlah bulan tidak valid'; end if;
  select greatest(now(), coalesce(paid_until, now()), coalesce(trial_ends_at, now())) into base from public.businesses where id = p_biz;
  if base is null then raise exception 'Bisnis tidak ditemukan'; end if;
  update public.businesses set paid_until = base + (p_months || ' months')::interval where id = p_biz;
  insert into public.subscription_payments(business_id, plan, months, amount, status, note, requested_by_name, reviewed_at, reviewed_by)
    values (p_biz, 'manual', p_months, 0, 'approved', 'Perpanjangan dari developer', 'Developer', now(), auth.uid());
end $$;
grant execute on function public.platform_extend(uuid, int) to authenticated;

create or replace function public.platform_set_exempt(p_biz uuid, p_exempt boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.platform_is_admin() then raise exception 'Bukan admin platform'; end if;
  update public.businesses set exempt = p_exempt where id = p_biz;
end $$;
grant execute on function public.platform_set_exempt(uuid, boolean) to authenticated;

create or replace function public.platform_set_setting(p_key text, p_value text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.platform_is_admin() then raise exception 'Bukan admin platform'; end if;
  if p_key not in ('pay_qris', 'pay_info', 'trial_days', 'dev_wa') then raise exception 'Pengaturan tidak dikenal'; end if;
  if p_key = 'trial_days' and p_value !~ '^[0-9]+$' then raise exception 'Lama demo harus berupa angka hari'; end if;
  insert into public.platform_settings(key, value) values (p_key, p_value)
  on conflict (key) do update set value = excluded.value;
end $$;
grant execute on function public.platform_set_setting(text, text) to authenticated;

create or replace function public.platform_set_plan(p_code text, p_name text, p_months int, p_price numeric, p_active boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.platform_is_admin() then raise exception 'Bukan admin platform'; end if;
  if p_code !~ '^[a-z0-9_]{1,20}$' then raise exception 'Kode paket tidak valid'; end if;
  if coalesce(p_months, 0) < 1 or coalesce(p_price, -1) < 0 or coalesce(p_name, '') = '' then raise exception 'Nama, lama, dan harga paket wajib diisi dengan benar'; end if;
  insert into public.plans(code, name, months, price, active) values (p_code, p_name, p_months, p_price, coalesce(p_active, true))
  on conflict (code) do update set name = excluded.name, months = excluded.months, price = excluded.price, active = excluded.active;
end $$;
grant execute on function public.platform_set_plan(text, text, int, numeric, boolean) to authenticated;

-- Hapus bisnis (permanen): sekarang ikut menghapus catatan pembayaran langganannya
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
  foreach t in array array['transaction_items','receivable_payments','receivables','transactions','shifts','attendance','cashbons','expenses',
                           'fine_waivers','waste_logs','transfer_items','transfers','branch_stock','product_ingredients',
                           'products','ingredients','settings','subscription_payments'] loop
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

-- 9) Hasil: status langganan semua bisnis saat ini
select b.name as bisnis, public.biz_sub_status(b.id) as status,
       case when b.exempt then 'gratis selamanya' else to_char(greatest(b.paid_until, b.trial_ends_at), 'DD Mon YYYY') end as sampai
from public.businesses b order by b.created_at;
