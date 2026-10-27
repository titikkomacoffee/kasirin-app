-- Jalankan di Supabase > SQL Editor > New query > Run (cukup sekali)
alter table public.profiles add column if not exists meal_allowance numeric default 0;

create or replace function public.is_staff() returns boolean
language sql security definer set search_path = public stable as $$
  select exists(select 1 from public.profiles where id = auth.uid() and role in ('admin','manager'))
$$;

create table if not exists public.cashbons(id uuid primary key default gen_random_uuid(), user_id uuid, amount numeric, note text, created_at timestamptz default now());
create table if not exists public.ingredients(id uuid primary key default gen_random_uuid(), name text not null, unit text default 'gram', created_at timestamptz default now());
create table if not exists public.transfers(id uuid primary key default gen_random_uuid(), from_name text, to_name text, created_by uuid, by_name text, created_at timestamptz default now());
create table if not exists public.transfer_items(id uuid primary key default gen_random_uuid(), transfer_id uuid references public.transfers on delete cascade, name text, unit text, qty numeric);

alter table public.cashbons enable row level security;
alter table public.ingredients enable row level security;
alter table public.transfers enable row level security;
alter table public.transfer_items enable row level security;

create policy "cashbons_read" on public.cashbons for select to authenticated using (true);
create policy "cashbons_admin" on public.cashbons for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "ing_read" on public.ingredients for select to authenticated using (true);
create policy "ing_staff" on public.ingredients for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "tr_all" on public.transfers for all to authenticated using (true) with check (true);
create policy "tri_all" on public.transfer_items for all to authenticated using (true) with check (true);
