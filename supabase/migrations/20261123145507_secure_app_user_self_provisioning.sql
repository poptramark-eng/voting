-- Replace the public SECURITY DEFINER provisioning RPC with narrowly scoped
-- self-provisioning under RLS. Auth0 JWT claims remain the source of identity.
drop function if exists public.ensure_app_user();

revoke all on table public.app_users from public, anon, authenticated;
grant select on table public.app_users to authenticated;
grant insert (auth_subject, email, display_name) on public.app_users to authenticated;
grant update (email, display_name) on public.app_users to authenticated;

drop policy if exists "users can read their own application identity" on public.app_users;
create policy "users can read their own application identity"
on public.app_users for select to authenticated
using (auth_subject = (select auth.jwt() ->> 'sub'));

drop policy if exists "users can provision their own application identity" on public.app_users;
create policy "users can provision their own application identity"
on public.app_users for insert to authenticated
with check (
  auth_subject = (select auth.jwt() ->> 'sub')
  and email is not distinct from nullif((select auth.jwt() ->> 'email'), '')
  and display_name is not distinct from nullif((select auth.jwt() ->> 'name'), '')
);

drop policy if exists "users can sync their own application identity" on public.app_users;
create policy "users can sync their own application identity"
on public.app_users for update to authenticated
using (auth_subject = (select auth.jwt() ->> 'sub'))
with check (
  auth_subject = (select auth.jwt() ->> 'sub')
  and email is not distinct from nullif((select auth.jwt() ->> 'email'), '')
  and display_name is not distinct from nullif((select auth.jwt() ->> 'name'), '')
);
