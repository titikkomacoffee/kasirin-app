-- LANGKAH 1 (jalankan sendiri dulu, lalu baru langkah 2)
-- Supabase > SQL Editor > New query > tempel > Run
alter type public.user_role add value if not exists 'admin';
alter type public.user_role add value if not exists 'manager';
alter type public.user_role add value if not exists 'kasir';
