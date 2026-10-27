-- KasirKu: PEMBAYARAN PIUTANG (tunai / QRIS) tercatat di kas, shift, dan laporan
-- Supabase > SQL Editor > New query > tempel SEMUA > Run
-- Syarat: multi-bisnis.sql sudah dijalankan. Aman diulang.

create table if not exists public.receivable_payments(
  id uuid primary key default gen_random_uuid(),
  business_id uuid default public.my_business(),
  receivable_id uuid references public.receivables(id) on delete cascade,
  amount numeric not null,
  method text default 'tunai',
  by_id uuid,
  by_name text,
  branch_id uuid,
  created_at timestamptz default now()
);

create index if not exists receivable_payments_biz_idx on public.receivable_payments(business_id);
create index if not exists receivable_payments_rcv_idx on public.receivable_payments(receivable_id);

alter table public.receivable_payments enable row level security;
drop policy if exists biz_all on public.receivable_payments;
create policy biz_all on public.receivable_payments for all to authenticated
  using (business_id = (select public.my_business()))
  with check (business_id = (select public.my_business()));

grant select, insert, update, delete on public.receivable_payments to authenticated;

-- Tanggal jatuh tempo sudah tidak dipakai lagi (kolomnya dibiarkan kosong, tidak perlu diubah).

-- Hasil: jumlah catatan pembayaran piutang yang ada
select count(*) as catatan_pembayaran_piutang from public.receivable_payments;
