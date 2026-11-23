-- Initial multi-tenant voting platform foundation.
-- This migration intentionally does NOT create ballot submission or voter-to-ballot links.
-- Cryptographic eligibility/nullifier and end-to-end verifiability protocols require
-- separate threat modelling and independent review before ballot-box implementation.

create extension if not exists pgcrypto with schema extensions;

create type public.organization_member_role as enum (
  'OWNER',
  'ADMIN',
  'ELECTION_MANAGER',
  'AUDITOR',
  'OBSERVER',
  'BILLING_MANAGER',
  'MEMBER'
);

create type public.organization_member_status as enum (
  'INVITED',
  'ACTIVE',
  'SUSPENDED',
  'REMOVED'
);

create type public.voting_category as enum (
  'GENERAL_POLL',
  'CONTEST',
  'ORGANIZATIONAL_ELECTION',
  'PUBLIC_ELECTION'
);

create type public.assurance_tier as enum (
  'STANDARD',
  'ENHANCED',
  'HIGH',
  'CRITICAL'
);

create type public.process_status as enum (
  'DRAFT',
  'PENDING_APPROVAL',
  'SCHEDULED',
  'OPEN',
  'SUSPENDED',
  'CLOSED',
  'TERMINATED',
  'UNDER_REVIEW',
  'CERTIFIED'
);

create type public.ballot_format as enum (
  'SINGLE_CHOICE',
  'MULTIPLE_CHOICE',
  'RANKED_CHOICE',
  'YES_NO',
  'APPROVAL',
  'SCORED'
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 160),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$'),
  country_code char(2) not null default 'KE',
  default_currency char(3) not null default 'KES',
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  role public.organization_member_role not null default 'MEMBER',
  status public.organization_member_status not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create index organization_memberships_user_status_idx
  on public.organization_memberships(user_id, status);

create table public.voting_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  title text not null check (length(trim(title)) between 2 and 200),
  description text,
  category public.voting_category not null,
  assurance_tier public.assurance_tier not null default 'STANDARD',
  status public.process_status not null default 'DRAFT',
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index voting_events_org_created_idx
  on public.voting_events(organization_id, created_at desc);

create table public.voting_processes (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.voting_events(id) on delete restrict,
  title text not null check (length(trim(title)) between 2 and 200),
  status public.process_status not null default 'DRAFT',
  ballot_format public.ballot_format not null,
  eligibility_mode text not null check (
    eligibility_mode in ('OPEN_LINK', 'INVITATION_ONLY', 'MANAGED_REGISTER', 'VERIFIED_MEMBERSHIP', 'COMBINED')
  ),
  vote_change_policy jsonb not null default '{"kind":"DISABLED"}'::jsonb,
  results_disclosure jsonb not null default '{"kind":"AFTER_CLOSURE"}'::jsonb,
  opens_at timestamptz,
  closes_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (opens_at is null or closes_at is null or closes_at > opens_at)
);

create index voting_processes_event_idx on public.voting_processes(event_id);

create table public.contests (
  id uuid primary key default gen_random_uuid(),
  process_id uuid not null references public.voting_processes(id) on delete restrict,
  title text not null check (length(trim(title)) between 1 and 200),
  description text,
  display_order integer not null default 0 check (display_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index contests_process_order_idx on public.contests(process_id, display_order);

create table public.ballot_items (
  id uuid primary key default gen_random_uuid(),
  contest_id uuid not null references public.contests(id) on delete restrict,
  item_type text not null check (item_type in ('CANDIDATE', 'TEAM', 'GROUP', 'PARTY', 'PROPOSAL', 'OPTION')),
  label text not null check (length(trim(label)) between 1 and 200),
  description text,
  metadata jsonb not null default '{}'::jsonb,
  display_order integer not null default 0 check (display_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index ballot_items_contest_order_idx on public.ballot_items(contest_id, display_order);

-- Register records contain eligibility/identity data, never ballot choices.
create table public.voter_register_entries (
  id uuid primary key default gen_random_uuid(),
  process_id uuid not null references public.voting_processes(id) on delete restrict,
  external_reference text,
  display_name text,
  contact_email text,
  contact_phone text,
  eligibility_status text not null default 'PENDING'
    check (eligibility_status in ('PENDING', 'ELIGIBLE', 'REJECTED', 'REVOKED')),
  source text not null default 'MANUAL'
    check (source in ('MANUAL', 'CSV_IMPORT', 'SELF_REGISTRATION', 'INTEGRATION')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index voter_register_process_status_idx
  on public.voter_register_entries(process_id, eligibility_status);

-- Append-only application audit events. Do not store ballot choices or secrets here.
create table public.audit_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null check (length(trim(action)) between 1 and 120),
  resource_type text not null check (length(trim(resource_type)) between 1 and 80),
  resource_id text,
  event_data jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index audit_events_org_time_idx
  on public.audit_events(organization_id, occurred_at desc);

create or replace function public.is_active_org_member(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_memberships m
    where m.organization_id = target_org
      and m.user_id = (select auth.uid())
      and m.status = 'ACTIVE'
  );
$$;

create or replace function public.has_org_role(target_org uuid, allowed_roles public.organization_member_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_memberships m
    where m.organization_id = target_org
      and m.user_id = (select auth.uid())
      and m.status = 'ACTIVE'
      and m.role = any(allowed_roles)
  );
$$;

create or replace function public.create_organization(org_name text, org_slug text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_org_id uuid;
  caller_id uuid := auth.uid();
begin
  if caller_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  insert into public.organizations (name, slug, created_by)
  values (trim(org_name), lower(trim(org_slug)), caller_id)
  returning id into new_org_id;

  insert into public.organization_memberships (organization_id, user_id, role, status)
  values (new_org_id, caller_id, 'OWNER', 'ACTIVE');

  return new_org_id;
end;
$$;

revoke all on function public.is_active_org_member(uuid) from public;
revoke all on function public.has_org_role(uuid, public.organization_member_role[]) from public;
revoke all on function public.create_organization(text, text) from public;
grant execute on function public.is_active_org_member(uuid) to authenticated;
grant execute on function public.has_org_role(uuid, public.organization_member_role[]) to authenticated;
grant execute on function public.create_organization(text, text) to authenticated;

alter table public.organizations enable row level security;
alter table public.organization_memberships enable row level security;
alter table public.voting_events enable row level security;
alter table public.voting_processes enable row level security;
alter table public.contests enable row level security;
alter table public.ballot_items enable row level security;
alter table public.voter_register_entries enable row level security;
alter table public.audit_events enable row level security;

create policy "members can read their organizations"
on public.organizations for select to authenticated
using (public.is_active_org_member(id));

create policy "members can read organization memberships"
on public.organization_memberships for select to authenticated
using (public.is_active_org_member(organization_id));

create policy "members can read voting events"
on public.voting_events for select to authenticated
using (public.is_active_org_member(organization_id));

create policy "authorized managers can create voting events"
on public.voting_events for insert to authenticated
with check (
  public.has_org_role(organization_id, array['OWNER','ADMIN','ELECTION_MANAGER']::public.organization_member_role[])
  and created_by = (select auth.uid())
);

create policy "authorized managers can update draft voting events"
on public.voting_events for update to authenticated
using (
  status = 'DRAFT'
  and public.has_org_role(organization_id, array['OWNER','ADMIN','ELECTION_MANAGER']::public.organization_member_role[])
)
with check (
  public.has_org_role(organization_id, array['OWNER','ADMIN','ELECTION_MANAGER']::public.organization_member_role[])
);

create policy "members can read voting processes"
on public.voting_processes for select to authenticated
using (
  exists (
    select 1 from public.voting_events e
    where e.id = event_id and public.is_active_org_member(e.organization_id)
  )
);

create policy "authorized managers can create voting processes"
on public.voting_processes for insert to authenticated
with check (
  exists (
    select 1 from public.voting_events e
    where e.id = event_id
      and public.has_org_role(e.organization_id, array['OWNER','ADMIN','ELECTION_MANAGER']::public.organization_member_role[])
  )
  and created_by = (select auth.uid())
);

create policy "authorized managers can update draft voting processes"
on public.voting_processes for update to authenticated
using (
  status = 'DRAFT'
  and exists (
    select 1 from public.voting_events e
    where e.id = event_id
      and public.has_org_role(e.organization_id, array['OWNER','ADMIN','ELECTION_MANAGER']::public.organization_member_role[])
  )
)
with check (
  exists (
    select 1 from public.voting_events e
    where e.id = event_id
      and public.has_org_role(e.organization_id, array['OWNER','ADMIN','ELECTION_MANAGER']::public.organization_member_role[])
  )
);

create policy "members can read contests"
on public.contests for select to authenticated
using (
  exists (
    select 1 from public.voting_processes p
    join public.voting_events e on e.id = p.event_id
    where p.id = process_id and public.is_active_org_member(e.organization_id)
  )
);

create policy "authorized managers can manage contests"
on public.contests for all to authenticated
using (
  exists (
    select 1 from public.voting_processes p
    join public.voting_events e on e.id = p.event_id
    where p.id = process_id
      and p.status = 'DRAFT'
      and public.has_org_role(e.organization_id, array['OWNER','ADMIN','ELECTION_MANAGER']::public.organization_member_role[])
  )
)
with check (
  exists (
    select 1 from public.voting_processes p
    join public.voting_events e on e.id = p.event_id
    where p.id = process_id
      and p.status = 'DRAFT'
      and public.has_org_role(e.organization_id, array['OWNER','ADMIN','ELECTION_MANAGER']::public.organization_member_role[])
  )
);

create policy "members can read ballot items"
on public.ballot_items for select to authenticated
using (
  exists (
    select 1 from public.contests c
    join public.voting_processes p on p.id = c.process_id
    join public.voting_events e on e.id = p.event_id
    where c.id = contest_id and public.is_active_org_member(e.organization_id)
  )
);

create policy "authorized managers can manage ballot items"
on public.ballot_items for all to authenticated
using (
  exists (
    select 1 from public.contests c
    join public.voting_processes p on p.id = c.process_id
    join public.voting_events e on e.id = p.event_id
    where c.id = contest_id
      and p.status = 'DRAFT'
      and public.has_org_role(e.organization_id, array['OWNER','ADMIN','ELECTION_MANAGER']::public.organization_member_role[])
  )
)
with check (
  exists (
    select 1 from public.contests c
    join public.voting_processes p on p.id = c.process_id
    join public.voting_events e on e.id = p.event_id
    where c.id = contest_id
      and p.status = 'DRAFT'
      and public.has_org_role(e.organization_id, array['OWNER','ADMIN','ELECTION_MANAGER']::public.organization_member_role[])
  )
);

create policy "authorized managers and auditors can read voter registers"
on public.voter_register_entries for select to authenticated
using (
  exists (
    select 1 from public.voting_processes p
    join public.voting_events e on e.id = p.event_id
    where p.id = process_id
      and public.has_org_role(e.organization_id, array['OWNER','ADMIN','ELECTION_MANAGER','AUDITOR']::public.organization_member_role[])
  )
);

create policy "authorized managers can manage voter registers in draft processes"
on public.voter_register_entries for all to authenticated
using (
  exists (
    select 1 from public.voting_processes p
    join public.voting_events e on e.id = p.event_id
    where p.id = process_id
      and p.status = 'DRAFT'
      and public.has_org_role(e.organization_id, array['OWNER','ADMIN','ELECTION_MANAGER']::public.organization_member_role[])
  )
)
with check (
  exists (
    select 1 from public.voting_processes p
    join public.voting_events e on e.id = p.event_id
    where p.id = process_id
      and p.status = 'DRAFT'
      and public.has_org_role(e.organization_id, array['OWNER','ADMIN','ELECTION_MANAGER']::public.organization_member_role[])
  )
  and created_by = (select auth.uid())
);

create policy "auditors can read audit events"
on public.audit_events for select to authenticated
using (
  public.has_org_role(organization_id, array['OWNER','ADMIN','AUDITOR']::public.organization_member_role[])
);

-- Audit events are inserted by trusted server-side code only; no client update/delete policies.
grant usage on schema public to authenticated;
grant select on public.organizations, public.organization_memberships, public.voting_events,
  public.voting_processes, public.contests, public.ballot_items, public.voter_register_entries,
  public.audit_events to authenticated;
grant insert, update on public.voting_events, public.voting_processes to authenticated;
grant insert, update, delete on public.contests, public.ballot_items, public.voter_register_entries to authenticated;

-- Restrict organization creation to the hardened RPC; prevent direct client membership writes.
revoke insert, update, delete on public.organizations from anon, authenticated;
revoke insert, update, delete on public.organization_memberships from anon, authenticated;
revoke insert, update, delete on public.audit_events from anon, authenticated;
revoke update, delete on public.voter_register_entries from anon;
revoke insert, update, delete on public.voting_events, public.voting_processes, public.contests, public.ballot_items from anon;
