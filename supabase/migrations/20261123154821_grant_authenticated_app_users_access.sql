-- Allow Auth0-authenticated users to provision and read their own app_users row.
-- Row Level Security remains enabled and policies restrict each operation to auth_subject = JWT sub.
-- Deliberately do not grant these privileges to anon.
grant select, insert, update on table public.app_users to authenticated;
