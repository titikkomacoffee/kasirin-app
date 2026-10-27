-- Jalankan sekali di Supabase > SQL Editor > New query > Run
create table branches(id uuid primary key default gen_random_uuid(), name text not null, created_at timestamptz default now());
create table profiles(id uuid primary key references auth.users on delete cascade, name text, role text default 'kasir', branch_id uuid references branches, active boolean default true);
create table products(id uuid primary key default gen_random_uuid(), name text not null, sku text, category text default 'Umum', price numeric default 0, cost numeric default 0, stock int default 0, photo text, created_at timestamptz default now());
create table transactions(id uuid primary key default gen_random_uuid(), trx text unique, cashier_id uuid, cashier text, branch_id uuid, subtotal numeric, discount numeric default 0, total numeric, method text, paid numeric, change numeric default 0, proof text, customer text, created_at timestamptz default now());
create table transaction_items(id uuid primary key default gen_random_uuid(), trx_id uuid references transactions on delete cascade, product_id uuid, name text, price numeric, cost numeric, qty int);
create table receivables(id uuid primary key default gen_random_uuid(), trx_id uuid references transactions on delete cascade, customer text, total numeric, paid numeric default 0, due_date date, created_at timestamptz default now());
create table shifts(id uuid primary key default gen_random_uuid(), cashier_id uuid, cashier text, open_cash numeric, close_cash numeric, opened_at timestamptz default now(), closed_at timestamptz);
create table attendance(id uuid primary key default gen_random_uuid(), user_id uuid, name text, type text, photo text, lat float, lng float, created_at timestamptz default now());
create table settings(key text primary key, value text);

-- Akun pertama yang mendaftar otomatis jadi admin
create function handle_new_user() returns trigger language plpgsql security definer as $$
begin
  insert into profiles(id,name,role) values(new.id, split_part(new.email,'@',1), case when (select count(*) from profiles)=0 then 'admin' else 'kasir' end);
  return new;
end $$;
create trigger on_signup after insert on auth.users for each row execute function handle_new_user();

-- Keamanan: hanya pengguna yang login yang bisa akses
do $$ declare t text; begin
  foreach t in array array['branches','profiles','products','transactions','transaction_items','receivables','shifts','attendance','settings'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy "auth_all" on %I for all to authenticated using (true) with check (true)', t);
  end loop; end $$;

-- Penyimpanan foto (produk, QRIS, absensi, bukti bayar)
insert into storage.buckets(id,name,public) values('media','media',true) on conflict do nothing;
create policy "media_read" on storage.objects for select using (bucket_id='media');
create policy "media_write" on storage.objects for insert to authenticated with check (bucket_id='media');
