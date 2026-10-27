-- Jalankan di Supabase > SQL Editor > New query > Run (cukup sekali)
-- Agar Admin bisa menghapus anggota dan mengganti password anggota dari aplikasi.

create or replace function public.delete_member(uid uuid) returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if not public.is_admin() then raise exception 'Hanya admin yang boleh menghapus anggota'; end if;
  if uid = auth.uid() then raise exception 'Tidak bisa menghapus akun sendiri'; end if;
  delete from public.profiles where id = uid;
  delete from auth.users where id = uid;
end $$;
grant execute on function public.delete_member(uuid) to authenticated;

create or replace function public.set_member_password(uid uuid, pw text) returns void
language plpgsql security definer set search_path = public, auth, extensions as $$
begin
  if not public.is_admin() then raise exception 'Hanya admin yang boleh mengganti password'; end if;
  if length(pw) < 6 then raise exception 'Password minimal 6 karakter'; end if;
  update auth.users set encrypted_password = extensions.crypt(pw, extensions.gen_salt('bf')), updated_at = now() where id = uid;
end $$;
grant execute on function public.set_member_password(uuid, text) to authenticated;
