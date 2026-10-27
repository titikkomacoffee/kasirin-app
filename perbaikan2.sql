-- Jadikan akun admin@kasir.id sebagai Admin (jalankan di Supabase > SQL Editor)
update public.profiles set role='admin', active=true
where id=(select id from auth.users where email='admin@kasir.id');
select p.name, p.role from public.profiles p;
