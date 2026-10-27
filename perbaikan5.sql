-- Jalankan di Supabase > SQL Editor > New query > Run (cukup sekali)

-- Terima barang & Kembali ke Pusat
alter table public.transfers add column if not exists kind text default 'kirim';
alter table public.transfers add column if not exists status text default 'dikirim';
alter table public.transfers add column if not exists received_by text;
alter table public.transfers add column if not exists received_at timestamptz;

-- Catat terbuang
create table if not exists public.waste_logs(
  id uuid primary key default gen_random_uuid(),
  kind text, ref_id uuid, name text, unit text, qty numeric,
  reason text, note text, by_id uuid, by_name text,
  created_at timestamptz default now()
);
alter table public.waste_logs enable row level security;
create policy "waste_all" on public.waste_logs for all to authenticated using (true) with check (true);

-- Kurangi stok produk/bahan (beserta bahan resep) saat ada yang terbuang
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
