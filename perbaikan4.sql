-- Jalankan di Supabase > SQL Editor > New query > Run (cukup sekali)
alter table public.ingredients add column if not exists stock numeric default 0;

create table if not exists public.product_ingredients(
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.products on delete cascade,
  ingredient_id uuid references public.ingredients on delete cascade,
  qty numeric not null
);
alter table public.product_ingredients enable row level security;
create policy "pi_read" on public.product_ingredients for select to authenticated using (true);
create policy "pi_staff" on public.product_ingredients for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- Kurangi stok produk & bahan otomatis setelah transaksi selesai
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
