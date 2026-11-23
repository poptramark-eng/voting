-- Auth0 is the identity provider. Application identities are represented by
-- public.app_users and mapped from the immutable Auth0 subject claim.
-- These FKs to auth.users would incorrectly require every Auth0 user to also
-- exist in Supabase Auth, which is not part of this architecture.

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
