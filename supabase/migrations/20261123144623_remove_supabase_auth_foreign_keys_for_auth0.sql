alter table public.organizations
  drop constraint if exists organizations_created_by_fkey;
alter table public.organization_memberships
  drop constraint if exists organization_memberships_user_id_fkey;
alter table public.voting_events
  drop constraint if exists voting_events_created_by_fkey;
alter table public.voting_processes
  drop constraint if exists voting_processes_created_by_fkey;
alter table public.voter_register_entries
  drop constraint if exists voter_register_entries_created_by_fkey;
alter table public.audit_events
  drop constraint if exists audit_events_actor_user_id_fkey;

-- Application identities are keyed by app_users.id. The external Auth0
-- subject is mapped through app_users.auth_subject and must not be forced
-- to exist in Supabase Auth's auth.users table.