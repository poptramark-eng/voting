-- Auth0-backed identity mapping for Supabase third-party authentication.
-- Auth0 subject strings are not UUIDs. Keep stable internal UUIDs for relational
-- ownership while resolving the verified JWT sub claim to an application user.

create table public.app_users (
  id uuid primary key default gen_random_uuid(),
  auth_subject text not null unique,
  email text,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_users_auth_subject_nonempty check (length(trim(auth_subject)) > 0)
);

alter table public.app_users enable row level security;
revoke all on table public.app_users from public, anon, authenticated;
grant select, insert, update on table public.app_users to service_role;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.current_app_user_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select u.id
  from public.app_users u
  where u.auth_subject = (select auth.jwt() ->> 'sub')
  limit 1;
$function$;

revoke all on function private.current_app_user_id() from public, anon;
grant execute on function private.current_app_user_id() to authenticated;

create or replace function private.is_active_org_member(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.organization_memberships m
    where m.organization_id = target_org
      and m.user_id = (select private.current_app_user_id())
      and m.status = 'ACTIVE'
  );
$function$;

create or replace function private.has_org_role(
  target_org uuid,
  allowed_roles public.organization_member_role[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.organization_memberships m
    where m.organization_id = target_org
      and m.user_id = (select private.current_app_user_id())
      and m.status = 'ACTIVE'
      and m.role = any(allowed_roles)
  );
$function$;

revoke all on function private.is_active_org_member(uuid) from public, anon;
revoke all on function private.has_org_role(uuid, public.organization_member_role[]) from public, anon;
grant execute on function private.is_active_org_member(uuid) to authenticated;
grant execute on function private.has_org_role(uuid, public.organization_member_role[]) to authenticated;

create or replace function public.create_organization(org_name text, org_slug text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  new_org_id uuid;
  caller_id uuid := private.current_app_user_id();
begin
  if caller_id is null then
    raise exception 'Authenticated application identity is not provisioned' using errcode = '28000';
  end if;

  if org_name is null or length(trim(org_name)) = 0
     or org_slug is null or length(trim(org_slug)) = 0 then
    raise exception 'Organization name and slug are required' using errcode = '22023';
  end if;

  insert into public.organizations (name, slug, created_by)
  values (trim(org_name), lower(trim(org_slug)), caller_id)
  returning id into new_org_id;

  insert into public.organization_memberships (organization_id, user_id, role, status)
  values (new_org_id, caller_id, 'OWNER', 'ACTIVE');

  return new_org_id;
end;
$function$;

revoke all on function public.create_organization(text, text) from public, anon;
grant execute on function public.create_organization(text, text) to authenticated;

drop policy if exists "authorized managers can add voter register entries" on public.voter_register_entries;
create policy "authorized managers can add voter register entries"
on public.voter_register_entries for insert to authenticated
with check (
  exists (
    select 1 from public.voting_processes p
    join public.voting_events e on e.id = p.event_id
    where p.id = process_id
      and p.status = 'DRAFT'
      and private.has_org_role(e.organization_id, array['OWNER','ADMIN','ELECTION_MANAGER']::public.organization_member_role[])
  )
  and created_by = (select private.current_app_user_id())
);

drop policy if exists "authorized managers can create voting events" on public.voting_events;
create policy "authorized managers can create voting events"
on public.voting_events for insert to authenticated
with check (
  private.has_org_role(organization_id, array['OWNER','ADMIN','ELECTION_MANAGER']::public.organization_member_role[])
  and created_by = (select private.current_app_user_id())
);

drop policy if exists "authorized managers can create voting processes" on public.voting_processes;
create policy "authorized managers can create voting processes"
on public.voting_processes for insert to authenticated
with check (
  exists (
    select 1 from public.voting_events e
    where e.id = event_id
      and private.has_org_role(e.organization_id, array['OWNER','ADMIN','ELECTION_MANAGER']::public.organization_member_role[])
  )
  and created_by = (select private.current_app_user_id())
);

alter table public.organization_memberships
  add constraint organization_memberships_user_id_app_users_fk
  foreign key (user_id) references public.app_users(id) on delete restrict;
alter table public.organizations
  add constraint organizations_created_by_app_users_fk
  foreign key (created_by) references public.app_users(id) on delete restrict;
alter table public.voting_events
  add constraint voting_events_created_by_app_users_fk
  foreign key (created_by) references public.app_users(id) on delete restrict;
alter table public.voting_processes
  add constraint voting_processes_created_by_app_users_fk
  foreign key (created_by) references public.app_users(id) on delete restrict;
alter table public.voter_register_entries
  add constraint voter_register_entries_created_by_app_users_fk
  foreign key (created_by) references public.app_users(id) on delete restrict;
alter table public.audit_events
  add constraint audit_events_actor_user_id_app_users_fk
  foreign key (actor_user_id) references public.app_users(id) on delete restrict;

create index app_users_email_idx on public.app_users(email) where email is not null;
