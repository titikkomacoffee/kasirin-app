-- Jalankan di Supabase > SQL Editor > New query > Run (cukup sekali)
create table if not exists public.expenses(
  id uuid primary key default gen_random_uuid(),
  amount numeric not null,
  category text,
  note text,
  method text default 'tunai',
  by_id uuid, by_name text, branch_id uuid,
  created_at timestamptz default now()
);
alter table public.expenses enable row level security;
drop policy if exists "exp_all" on public.expenses;
create policy "exp_all" on public.expenses for all to authenticated using (true) with check (true);

-- Catatan rekonsiliasi kas saat tutup kasir
alter table public.shifts add column if not exists expected_cash numeric;
alter table public.shifts add column if not exists cash_sales numeric;
alter table public.shifts add column if not exists cash_expenses numeric;
alter table public.shifts add column if not exists diff numeric;
alter table public.shifts add column if not exists note text;
