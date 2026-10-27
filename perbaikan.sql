-- Jalankan di Supabase > SQL Editor > New query > Run (cukup sekali)

-- 1) Perbaiki error "Database error saving new user"
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id,name,role)
  values(new.id, split_part(new.email,'@',1),
         case when (select count(*) from public.profiles)=0 then 'admin' else 'kasir' end);
  return new;
end $$;

-- 2) Kolom gaji
alter table public.profiles add column if not exists base_salary numeric default 0;
alter table public.profiles add column if not exists bonus_per_item numeric default 0;

-- 3) Hanya admin yang boleh mengubah data karyawan (peran, gaji, dll)
create or replace function public.is_admin() returns boolean
language sql security definer set search_path = public stable as $$
  select exists(select 1 from public.profiles where id = auth.uid() and role = 'admin')
$$;
drop policy if exists "auth_all" on public.profiles;
create policy "profiles_read" on public.profiles for select to authenticated using (true);
create policy "profiles_admin_write" on public.profiles for all to authenticated using (public.is_admin()) with check (public.is_admin());
