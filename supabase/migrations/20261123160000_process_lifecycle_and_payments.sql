-- Process lifecycle governance and Paystack payment ledger.
-- This migration is intentionally committed to the feature branch first.
-- Review migration history alignment before applying it to the hosted project.

-- Public-election workflows remain disabled until jurisdiction-specific legal,
-- regulatory, security and operational authorization has been independently approved.
alter table public.voting_events
  add constraint voting_events_public_election_disabled
  check (category <> 'PUBLIC_ELECTION');


create or replace function private.set_row_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

drop trigger if exists voting_events_set_updated_at on public.voting_events;
create trigger voting_events_set_updated_at
before update on public.voting_events
for each row execute function private.set_row_updated_at();

drop trigger if exists voting_processes_set_updated_at on public.voting_processes;
create trigger voting_processes_set_updated_at
before update on public.voting_processes
for each row execute function private.set_row_updated_at();

revoke all on function private.set_row_updated_at() from public, anon, authenticated;

-- Process assurance is at least as strong as its parent event.
alter table public.voting_processes
  add column assurance_tier public.assurance_tier;

update public.voting_processes p
set assurance_tier = e.assurance_tier
from public.voting_events e
where e.id = p.event_id
  and p.assurance_tier is null;

alter table public.voting_processes
  alter column assurance_tier set default 'STANDARD',
  alter column assurance_tier set not null;

create or replace function private.assurance_tier_rank(target_tier public.assurance_tier)
returns integer
language sql
immutable
set search_path = ''
as $function$
  select case target_tier
    when 'STANDARD' then 1
    when 'ENHANCED' then 2
    when 'HIGH' then 3
    when 'CRITICAL' then 4
  end;
$function$;

create or replace function private.enforce_process_assurance_floor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  parent_tier public.assurance_tier;
begin
  select e.assurance_tier into parent_tier
  from public.voting_events e
  where e.id = new.event_id;

  if parent_tier is null then
    raise exception 'Parent voting event does not exist' using errcode = '23503';
  end if;

  if private.assurance_tier_rank(new.assurance_tier)
     < private.assurance_tier_rank(parent_tier) then
    new.assurance_tier := parent_tier;
  end if;

  return new;
end;
$function$;

drop trigger if exists voting_processes_assurance_floor on public.voting_processes;
create trigger voting_processes_assurance_floor
before insert or update of event_id, assurance_tier
on public.voting_processes
for each row execute function private.enforce_process_assurance_floor();

create or replace function private.propagate_event_assurance_floor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.assurance_tier is distinct from old.assurance_tier
     and private.assurance_tier_rank(new.assurance_tier)
         > private.assurance_tier_rank(old.assurance_tier) then
    update public.voting_processes
    set assurance_tier = new.assurance_tier,
        updated_at = now()
    where event_id = new.id
      and private.assurance_tier_rank(assurance_tier)
          < private.assurance_tier_rank(new.assurance_tier);
  end if;
  return new;
end;
$function$;

drop trigger if exists voting_events_raise_process_assurance on public.voting_events;
create trigger voting_events_raise_process_assurance
after update of assurance_tier on public.voting_events
for each row execute function private.propagate_event_assurance_floor();

create or replace function private.required_process_approvals(target_tier public.assurance_tier)
returns smallint
language sql
immutable
set search_path = ''
as $function$
  select case target_tier
    when 'STANDARD' then 1::smallint
    when 'ENHANCED' then 2::smallint
    when 'HIGH' then 2::smallint
    when 'CRITICAL' then 3::smallint
  end;
$function$;

create table public.process_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  process_id uuid not null references public.voting_processes(id) on delete restrict,
  actor_user_id uuid not null references public.app_users(id) on delete restrict,
  action text not null check (length(trim(action)) between 1 and 80),
  from_status public.process_status not null,
  to_status public.process_status not null,
  reason text not null check (length(trim(reason)) between 1 and 2000),
  evidence jsonb not null default '{}'::jsonb,
  workflow_request_id uuid,
  occurred_at timestamptz not null default now()
);

create index process_lifecycle_events_process_time_idx
  on public.process_lifecycle_events(process_id, occurred_at desc);
create index process_lifecycle_events_org_time_idx
  on public.process_lifecycle_events(organization_id, occurred_at desc);

create table public.process_workflow_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  process_id uuid not null references public.voting_processes(id) on delete restrict,
  requested_by uuid not null references public.app_users(id) on delete restrict,
  action text not null check (action in ('APPROVE_PROCESS', 'RESUME_PROCESS', 'TERMINATE_PROCESS')),
  status text not null default 'PENDING'
    check (status in ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
  reason text not null check (length(trim(reason)) between 1 and 2000),
  assurance_tier public.assurance_tier not null,
  required_approvals smallint not null check (required_approvals between 1 and 3),
  process_updated_at timestamptz not null,
  request_data jsonb not null default '{}'::jsonb,
  requested_at timestamptz not null default now(),
  resolved_at timestamptz
);

alter table public.process_lifecycle_events
  add constraint process_lifecycle_events_workflow_request_fk
  foreign key (workflow_request_id)
  references public.process_workflow_requests(id)
  on delete restrict;

create index process_workflow_requests_org_status_idx
  on public.process_workflow_requests(organization_id, status, requested_at desc);
create index process_workflow_requests_process_idx
  on public.process_workflow_requests(process_id, requested_at desc);
create unique index process_workflow_one_pending_request_idx
  on public.process_workflow_requests(process_id)
  where status = 'PENDING';

create table public.process_workflow_approvals (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.process_workflow_requests(id) on delete restrict,
  approver_user_id uuid not null references public.app_users(id) on delete restrict,
  decision text not null check (decision in ('APPROVE', 'REJECT')),
  comment text check (comment is null or length(comment) <= 2000),
  decided_at timestamptz not null default now(),
  constraint process_workflow_approvals_one_decision_per_user
    unique (request_id, approver_user_id)
);

create index process_workflow_approvals_request_idx
  on public.process_workflow_approvals(request_id, decided_at);


-- Organization memberships contain organization-wide roles only. Election,
-- auditor and observer authority is represented by event/process assignments.
alter table public.organization_memberships
  add constraint organization_memberships_only_org_roles
  check (role in ('OWNER', 'ADMIN', 'BILLING_MANAGER', 'MEMBER'));

create table public.event_role_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  event_id uuid not null references public.voting_events(id) on delete restrict,
  user_id uuid not null references public.app_users(id) on delete restrict,
  role public.organization_member_role not null
    check (role in ('ELECTION_MANAGER', 'AUDITOR', 'OBSERVER')),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'REVOKED')),
  expires_at timestamptz,
  assigned_by uuid not null references public.app_users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint event_role_assignments_one_role_per_user unique (event_id, user_id)
);

create table public.process_role_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  event_id uuid not null references public.voting_events(id) on delete restrict,
  process_id uuid not null references public.voting_processes(id) on delete restrict,
  user_id uuid not null references public.app_users(id) on delete restrict,
  role public.organization_member_role not null
    check (role in ('ELECTION_MANAGER', 'AUDITOR', 'OBSERVER')),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'REVOKED')),
  expires_at timestamptz,
  assigned_by uuid not null references public.app_users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint process_role_assignments_one_role_per_user unique (process_id, user_id)
);

create index event_role_assignments_org_user_idx
  on public.event_role_assignments(organization_id, user_id, status);
create index event_role_assignments_event_role_idx
  on public.event_role_assignments(event_id, role, status);
create index process_role_assignments_process_role_idx
  on public.process_role_assignments(process_id, role, status);

alter table public.event_role_assignments enable row level security;
alter table public.process_role_assignments enable row level security;
revoke all on public.event_role_assignments, public.process_role_assignments
  from public, anon, authenticated;
grant select on public.event_role_assignments, public.process_role_assignments to authenticated;

create policy "members can read their scoped event role assignments"
on public.event_role_assignments for select to authenticated
using (
  user_id = (select private.current_app_user_id())
  or private.has_org_role(
    organization_id,
    array['OWNER','ADMIN']::public.organization_member_role[]
  )
);

create policy "members can read their scoped process role assignments"
on public.process_role_assignments for select to authenticated
using (
  user_id = (select private.current_app_user_id())
  or private.has_org_role(
    organization_id,
    array['OWNER','ADMIN']::public.organization_member_role[]
  )
);

create table private.scoped_role_permissions (
  role public.organization_member_role not null
    check (role in ('ELECTION_MANAGER', 'AUDITOR', 'OBSERVER')),
  permission text not null,
  primary key (role, permission)
);

insert into private.scoped_role_permissions (role, permission) values
  ('ELECTION_MANAGER', 'event.read'),
  ('ELECTION_MANAGER', 'event.update'),
  ('ELECTION_MANAGER', 'process.read'),
  ('ELECTION_MANAGER', 'process.create'),
  ('ELECTION_MANAGER', 'process.update'),
  ('ELECTION_MANAGER', 'process.submit'),
  ('ELECTION_MANAGER', 'process.lifecycle.read'),
  ('ELECTION_MANAGER', 'contest.read'),
  ('ELECTION_MANAGER', 'contest.manage'),
  ('ELECTION_MANAGER', 'ballot_structure.read'),
  ('ELECTION_MANAGER', 'ballot_structure.manage'),
  ('AUDITOR', 'event.read'),
  ('AUDITOR', 'process.read'),
  ('AUDITOR', 'contest.read'),
  ('AUDITOR', 'ballot_structure.read'),
  ('AUDITOR', 'audit.read'),
  ('OBSERVER', 'event.read'),
  ('OBSERVER', 'process.read'),
  ('OBSERVER', 'contest.read'),
  ('OBSERVER', 'observer.status.read');

revoke all on private.scoped_role_permissions from public, anon, authenticated;

create or replace function private.has_event_permission(
  target_event uuid,
  target_permission text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.event_role_assignments a
    join public.voting_events e on e.id = a.event_id
    join public.organization_memberships m
      on m.organization_id = e.organization_id
     and m.user_id = a.user_id
    join private.scoped_role_permissions rp
      on rp.role = a.role
     and rp.permission = target_permission
    where a.event_id = target_event
      and a.user_id = (select private.current_app_user_id())
      and a.organization_id = e.organization_id
      and a.status = 'ACTIVE'
      and (a.expires_at is null or a.expires_at > now())
      and m.status = 'ACTIVE'
  );
$function$;

create or replace function private.has_process_permission(
  target_process uuid,
  target_permission text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.voting_processes p
    join public.voting_events e on e.id = p.event_id
    join public.organization_memberships m
      on m.organization_id = e.organization_id
     and m.user_id = (select private.current_app_user_id())
    join public.event_role_assignments ea
      on ea.event_id = e.id
     and ea.user_id = m.user_id
    left join public.process_role_assignments pa
      on pa.process_id = p.id
     and pa.user_id = m.user_id
    join private.scoped_role_permissions event_permission
      on event_permission.role = ea.role
     and event_permission.permission = target_permission
    where p.id = target_process
      and ea.organization_id = e.organization_id
      and m.status = 'ACTIVE'
      and ea.status = 'ACTIVE'
      and (ea.expires_at is null or ea.expires_at > now())
      and (
        pa.id is null
        or (
          pa.organization_id = e.organization_id
          and pa.event_id = e.id
          and pa.status = 'ACTIVE'
          and (pa.expires_at is null or pa.expires_at > now())
          and exists (
            select 1
            from private.scoped_role_permissions process_permission
            where process_permission.role = pa.role
              and process_permission.permission = target_permission
          )
        )
      )
  );
$function$;

revoke all on function private.has_event_permission(uuid, text) from public, anon;
revoke all on function private.has_process_permission(uuid, text) from public, anon;
grant execute on function private.has_event_permission(uuid, text) to authenticated;
grant execute on function private.has_process_permission(uuid, text) to authenticated;

create or replace function public.assign_event_role(
  target_event uuid,
  target_user uuid,
  target_role public.organization_member_role,
  target_expires_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := private.current_app_user_id();
  target_org uuid;
  assignment_id uuid;
begin
  if caller_id is null then
    raise exception 'Authenticated application identity is required' using errcode = '28000';
  end if;
  if target_role is null or target_role not in ('ELECTION_MANAGER', 'AUDITOR', 'OBSERVER') then
    raise exception 'Only ELECTION_MANAGER, AUDITOR or OBSERVER can be assigned at event scope' using errcode = '22023';
  end if;
  if target_expires_at is not null and target_expires_at <= now() then
    raise exception 'Assignment expiry must be in the future' using errcode = '22023';
  end if;

  select organization_id into target_org
  from public.voting_events
  where id = target_event
  for update;

  if target_org is null then
    raise exception 'Voting event not found' using errcode = 'P0002';
  end if;
  if not private.has_org_role(target_org, array['OWNER','ADMIN']::public.organization_member_role[]) then
    raise exception 'Only an active organization OWNER or ADMIN can assign scoped roles' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.organization_memberships m
    where m.organization_id = target_org
      and m.user_id = target_user
      and m.status = 'ACTIVE'
  ) then
    raise exception 'Scoped-role recipient must be an active organization member' using errcode = '22023';
  end if;

  update public.process_role_assignments
  set status = 'REVOKED', updated_at = now()
  where event_id = target_event and user_id = target_user and status = 'ACTIVE';

  insert into public.event_role_assignments (
    organization_id, event_id, user_id, role, status, expires_at, assigned_by
  )
  values (target_org, target_event, target_user, target_role, 'ACTIVE', target_expires_at, caller_id)
  on conflict (event_id, user_id) do update
  set role = excluded.role,
      status = 'ACTIVE',
      expires_at = excluded.expires_at,
      assigned_by = excluded.assigned_by,
      updated_at = now()
  returning id into assignment_id;

  insert into public.audit_events (
    organization_id, actor_user_id, action, resource_type, resource_id, event_data
  )
  values (
    target_org, caller_id, 'EVENT_ROLE_ASSIGNED',
    'voting_event', target_event::text,
    jsonb_build_object('user_id', target_user, 'role', target_role, 'expires_at', target_expires_at)
  );

  return assignment_id;
end;
$function$;

create or replace function public.assign_process_role(
  target_process uuid,
  target_user uuid,
  target_role public.organization_member_role,
  target_expires_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := private.current_app_user_id();
  target_org uuid;
  target_event uuid;
  event_role public.organization_member_role;
  assignment_id uuid;
begin
  if caller_id is null then
    raise exception 'Authenticated application identity is required' using errcode = '28000';
  end if;
  if target_role is null or target_role not in ('ELECTION_MANAGER', 'AUDITOR', 'OBSERVER') then
    raise exception 'Only ELECTION_MANAGER, AUDITOR or OBSERVER can be assigned at process scope' using errcode = '22023';
  end if;
  if target_expires_at is not null and target_expires_at <= now() then
    raise exception 'Assignment expiry must be in the future' using errcode = '22023';
  end if;

  select e.organization_id, e.id
  into target_org, target_event
  from public.voting_processes p
  join public.voting_events e on e.id = p.event_id
  where p.id = target_process
  for update of p;

  if target_org is null then
    raise exception 'Voting process not found' using errcode = 'P0002';
  end if;
  if not private.has_org_role(target_org, array['OWNER','ADMIN']::public.organization_member_role[]) then
    raise exception 'Only an active organization OWNER or ADMIN can assign scoped roles' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.organization_memberships m
    where m.organization_id = target_org
      and m.user_id = target_user
      and m.status = 'ACTIVE'
  ) then
    raise exception 'Scoped-role recipient must be an active organization member' using errcode = '22023';
  end if;

  select a.role into event_role
  from public.event_role_assignments a
  where a.event_id = target_event
    and a.user_id = target_user
    and a.organization_id = target_org
    and a.status = 'ACTIVE'
    and (a.expires_at is null or a.expires_at > now());

  if event_role is null then
    raise exception 'A valid event-level role assignment is required before process-level narrowing' using errcode = '22023';
  end if;

  insert into public.process_role_assignments (
    organization_id, event_id, process_id, user_id, role, status, expires_at, assigned_by
  )
  values (
    target_org, target_event, target_process, target_user, target_role, 'ACTIVE', target_expires_at, caller_id
  )
  on conflict (process_id, user_id) do update
  set role = excluded.role,
      status = 'ACTIVE',
      expires_at = excluded.expires_at,
      assigned_by = excluded.assigned_by,
      updated_at = now()
  returning id into assignment_id;

  insert into public.audit_events (
    organization_id, actor_user_id, action, resource_type, resource_id, event_data
  )
  values (
    target_org, caller_id, 'PROCESS_ROLE_ASSIGNED',
    'voting_process', target_process::text,
    jsonb_build_object('user_id', target_user, 'role', target_role, 'expires_at', target_expires_at)
  );

  return assignment_id;
end;
$function$;

create or replace function public.revoke_event_role(target_event uuid, target_user uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := private.current_app_user_id();
  target_org uuid;
begin
  select organization_id into target_org
  from public.voting_events
  where id = target_event
  for update;

  if target_org is null then
    raise exception 'Voting event not found' using errcode = 'P0002';
  end if;
  if caller_id is null or not private.has_org_role(target_org, array['OWNER','ADMIN']::public.organization_member_role[]) then
    raise exception 'Only an active organization OWNER or ADMIN can revoke scoped roles' using errcode = '42501';
  end if;

  update public.event_role_assignments
  set status = 'REVOKED', updated_at = now()
  where event_id = target_event and user_id = target_user and status = 'ACTIVE';

  update public.process_role_assignments
  set status = 'REVOKED', updated_at = now()
  where event_id = target_event and user_id = target_user and status = 'ACTIVE';

  insert into public.audit_events (
    organization_id, actor_user_id, action, resource_type, resource_id, event_data
  )
  values (
    target_org, caller_id, 'EVENT_ROLE_REVOKED',
    'voting_event', target_event::text,
    jsonb_build_object('user_id', target_user)
  );

  return true;
end;
$function$;

create or replace function public.revoke_process_role(target_process uuid, target_user uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := private.current_app_user_id();
  target_org uuid;
begin
  select e.organization_id into target_org
  from public.voting_processes p
  join public.voting_events e on e.id = p.event_id
  where p.id = target_process
  for update of p;

  if target_org is null then
    raise exception 'Voting process not found' using errcode = 'P0002';
  end if;
  if caller_id is null or not private.has_org_role(target_org, array['OWNER','ADMIN']::public.organization_member_role[]) then
    raise exception 'Only an active organization OWNER or ADMIN can revoke scoped roles' using errcode = '42501';
  end if;

  update public.process_role_assignments
  set status = 'REVOKED', updated_at = now()
  where process_id = target_process and user_id = target_user and status = 'ACTIVE';

  insert into public.audit_events (
    organization_id, actor_user_id, action, resource_type, resource_id, event_data
  )
  values (
    target_org, caller_id, 'PROCESS_ROLE_REVOKED',
    'voting_process', target_process::text,
    jsonb_build_object('user_id', target_user)
  );

  return true;
end;
$function$;

revoke all on function public.assign_event_role(uuid, uuid, public.organization_member_role, timestamptz) from public, anon;
revoke all on function public.assign_process_role(uuid, uuid, public.organization_member_role, timestamptz) from public, anon;
revoke all on function public.revoke_event_role(uuid, uuid) from public, anon;
revoke all on function public.revoke_process_role(uuid, uuid) from public, anon;
grant execute on function public.assign_event_role(uuid, uuid, public.organization_member_role, timestamptz) to authenticated;
grant execute on function public.assign_process_role(uuid, uuid, public.organization_member_role, timestamptz) to authenticated;
grant execute on function public.revoke_event_role(uuid, uuid) to authenticated;
grant execute on function public.revoke_process_role(uuid, uuid) to authenticated;

-- Replace organization-wide scoped-role policies with explicit scoped grants.
drop policy if exists "authorized managers can create voting events" on public.voting_events;
create policy "organization admins can create voting events"
on public.voting_events for insert to authenticated
with check (
  private.has_org_role(organization_id, array['OWNER','ADMIN']::public.organization_member_role[])
  and created_by = (select private.current_app_user_id())
);

drop policy if exists "authorized managers can update draft voting events" on public.voting_events;
create policy "event managers can update draft voting events"
on public.voting_events for update to authenticated
using (
  status = 'DRAFT'
  and (
    private.has_org_role(organization_id, array['OWNER','ADMIN']::public.organization_member_role[])
    or private.has_event_permission(id, 'event.update')
  )
)
with check (
  status = 'DRAFT'
  and (
    private.has_org_role(organization_id, array['OWNER','ADMIN']::public.organization_member_role[])
    or private.has_event_permission(id, 'event.update')
  )
);

drop policy if exists "members can read voting events" on public.voting_events;
create policy "scoped members can read voting events"
on public.voting_events for select to authenticated
using (
  private.has_org_role(organization_id, array['OWNER','ADMIN']::public.organization_member_role[])
  or private.has_event_permission(id, 'event.read')
);

drop policy if exists "authorized managers can create voting processes" on public.voting_processes;
create policy "event managers can create voting processes"
on public.voting_processes for insert to authenticated
with check (
  exists (
    select 1 from public.voting_events e
    where e.id = event_id
      and (
        private.has_org_role(e.organization_id, array['OWNER','ADMIN']::public.organization_member_role[])
        or private.has_event_permission(e.id, 'process.create')
      )
  )
  and created_by = (select private.current_app_user_id())
);

drop policy if exists "authorized managers can update draft voting processes" on public.voting_processes;
create policy "scoped managers can update draft voting processes"
on public.voting_processes for update to authenticated
using (
  status = 'DRAFT'
  and exists (
    select 1 from public.voting_events e
    where e.id = event_id
      and (
        private.has_org_role(e.organization_id, array['OWNER','ADMIN']::public.organization_member_role[])
        or private.has_process_permission(id, 'process.update')
      )
  )
)
with check (
  status = 'DRAFT'
  and exists (
    select 1 from public.voting_events e
    where e.id = event_id
      and (
        private.has_org_role(e.organization_id, array['OWNER','ADMIN']::public.organization_member_role[])
        or private.has_process_permission(id, 'process.update')
      )
  )
);

drop policy if exists "members can read voting processes" on public.voting_processes;
create policy "scoped members can read voting processes"
on public.voting_processes for select to authenticated
using (
  exists (
    select 1 from public.voting_events e
    where e.id = event_id
      and (
        private.has_org_role(e.organization_id, array['OWNER','ADMIN']::public.organization_member_role[])
        or private.has_process_permission(id, 'process.read')
      )
  )
);

drop policy if exists "authorized managers can create contests" on public.contests;
create policy "scoped managers can create contests"
on public.contests for insert to authenticated
with check (
  exists (
    select 1 from public.voting_processes p
    join public.voting_events e on e.id = p.event_id
    where p.id = process_id
      and p.status = 'DRAFT'
      and (
        private.has_org_role(e.organization_id, array['OWNER','ADMIN']::public.organization_member_role[])
        or private.has_process_permission(p.id, 'contest.manage')
      )
  )
);

drop policy if exists "authorized managers can update contests" on public.contests;
create policy "scoped managers can update contests"
on public.contests for update to authenticated
using (
  exists (
    select 1 from public.voting_processes p
    join public.voting_events e on e.id = p.event_id
    where p.id = process_id
      and p.status = 'DRAFT'
      and (
        private.has_org_role(e.organization_id, array['OWNER','ADMIN']::public.organization_member_role[])
        or private.has_process_permission(p.id, 'contest.manage')
      )
  )
)
with check (
  exists (
    select 1 from public.voting_processes p
    join public.voting_events e on e.id = p.event_id
    where p.id = process_id
      and p.status = 'DRAFT'
      and (
        private.has_org_role(e.organization_id, array['OWNER','ADMIN']::public.organization_member_role[])
        or private.has_process_permission(p.id, 'contest.manage')
      )
  )
);

drop policy if exists "members can read contests" on public.contests;
create policy "scoped members can read contests"
on public.contests for select to authenticated
using (
  exists (
    select 1 from public.voting_processes p
    join public.voting_events e on e.id = p.event_id
    where p.id = process_id
      and (
        private.has_org_role(e.organization_id, array['OWNER','ADMIN']::public.organization_member_role[])
        or private.has_process_permission(p.id, 'contest.read')
      )
  )
);

drop policy if exists "authorized managers can create ballot items" on public.ballot_items;
create policy "scoped managers can create ballot items"
on public.ballot_items for insert to authenticated
with check (
  exists (
    select 1 from public.contests c
    join public.voting_processes p on p.id = c.process_id
    join public.voting_events e on e.id = p.event_id
    where c.id = contest_id
      and p.status = 'DRAFT'
      and (
        private.has_org_role(e.organization_id, array['OWNER','ADMIN']::public.organization_member_role[])
        or private.has_process_permission(p.id, 'ballot_structure.manage')
      )
  )
);

drop policy if exists "authorized managers can update ballot items" on public.ballot_items;
create policy "scoped managers can update ballot items"
on public.ballot_items for update to authenticated
using (
  exists (
    select 1 from public.contests c
    join public.voting_processes p on p.id = c.process_id
    join public.voting_events e on e.id = p.event_id
    where c.id = contest_id
      and p.status = 'DRAFT'
      and (
        private.has_org_role(e.organization_id, array['OWNER','ADMIN']::public.organization_member_role[])
        or private.has_process_permission(p.id, 'ballot_structure.manage')
      )
  )
)
with check (
  exists (
    select 1 from public.contests c
    join public.voting_processes p on p.id = c.process_id
    join public.voting_events e on e.id = p.event_id
    where c.id = contest_id
      and p.status = 'DRAFT'
      and (
        private.has_org_role(e.organization_id, array['OWNER','ADMIN']::public.organization_member_role[])
        or private.has_process_permission(p.id, 'ballot_structure.manage')
      )
  )
);

drop policy if exists "members can read ballot items" on public.ballot_items;
create policy "managers and auditors can read ballot items"
on public.ballot_items for select to authenticated
using (
  exists (
    select 1 from public.contests c
    join public.voting_processes p on p.id = c.process_id
    join public.voting_events e on e.id = p.event_id
    where c.id = contest_id
      and (
        private.has_org_role(e.organization_id, array['OWNER','ADMIN']::public.organization_member_role[])
        or private.has_process_permission(p.id, 'ballot_structure.read')
      )
  )
);

-- Voter register rows contain identifying data. Until the separate purpose-
-- specific PII grant workflow is implemented, only OWNER/ADMIN may read or write.
drop policy if exists "authorized managers and auditors can read voter registers" on public.voter_register_entries;
create policy "organization admins can read voter registers"
on public.voter_register_entries for select to authenticated
using (
  exists (
    select 1 from public.voting_processes p
    join public.voting_events e on e.id = p.event_id
    where p.id = process_id
      and private.has_org_role(e.organization_id, array['OWNER','ADMIN']::public.organization_member_role[])
  )
);

drop policy if exists "authorized managers can add voter register entries" on public.voter_register_entries;
create policy "organization admins can add voter register entries"
on public.voter_register_entries for insert to authenticated
with check (
  exists (
    select 1 from public.voting_processes p
    join public.voting_events e on e.id = p.event_id
    where p.id = process_id
      and p.status = 'DRAFT'
      and private.has_org_role(e.organization_id, array['OWNER','ADMIN']::public.organization_member_role[])
  )
  and created_by = (select private.current_app_user_id())
);

drop policy if exists "authorized managers can update voter register entries" on public.voter_register_entries;
create policy "organization admins can update voter register entries"
on public.voter_register_entries for update to authenticated
using (
  exists (
    select 1 from public.voting_processes p
    join public.voting_events e on e.id = p.event_id
    where p.id = process_id
      and p.status = 'DRAFT'
      and private.has_org_role(e.organization_id, array['OWNER','ADMIN']::public.organization_member_role[])
  )
)
with check (
  exists (
    select 1 from public.voting_processes p
    join public.voting_events e on e.id = p.event_id
    where p.id = process_id
      and p.status = 'DRAFT'
      and private.has_org_role(e.organization_id, array['OWNER','ADMIN']::public.organization_member_role[])
  )
);

drop policy if exists "auditors can read audit events" on public.audit_events;
create policy "organization admins and scoped auditors can read audit events"
on public.audit_events for select to authenticated
using (
  private.has_org_role(organization_id, array['OWNER','ADMIN']::public.organization_member_role[])
  or (
    resource_type = 'voting_process'
    and private.has_process_permission(
      case when resource_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then resource_id::uuid else null end,
      'audit.read'
    )
  )
  or (
    resource_type = 'voting_event'
    and private.has_event_permission(
      case when resource_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then resource_id::uuid else null end,
      'audit.read'
    )
  )
);

alter table public.process_lifecycle_events enable row level security;
alter table public.process_workflow_requests enable row level security;
alter table public.process_workflow_approvals enable row level security;

revoke all on public.process_lifecycle_events,
  public.process_workflow_requests,
  public.process_workflow_approvals
from public, anon, authenticated;

grant select on public.process_lifecycle_events,
  public.process_workflow_requests,
  public.process_workflow_approvals
to authenticated;

create policy "governance roles can read process lifecycle events"
on public.process_lifecycle_events for select to authenticated
using (
  private.has_org_role(organization_id, array['OWNER','ADMIN']::public.organization_member_role[])
  or private.has_process_permission(process_id, 'process.lifecycle.read')
  or private.has_process_permission(process_id, 'audit.read')
);

create policy "governance roles can read process workflow requests"
on public.process_workflow_requests for select to authenticated
using (
  private.has_org_role(organization_id, array['OWNER','ADMIN']::public.organization_member_role[])
  or private.has_process_permission(process_id, 'process.lifecycle.read')
  or private.has_process_permission(process_id, 'audit.read')
);

create policy "governance roles can read process workflow approvals"
on public.process_workflow_approvals for select to authenticated
using (
  exists (
    select 1
    from public.process_workflow_requests r
    where r.id = request_id
      and (
        private.has_org_role(r.organization_id, array['OWNER','ADMIN']::public.organization_member_role[])
        or private.has_process_permission(r.process_id, 'audit.read')
      )
  )
);

create or replace function private.create_process_workflow_request(
  target_organization uuid,
  target_process uuid,
  requesting_user uuid,
  target_action text,
  target_reason text,
  target_tier public.assurance_tier,
  target_process_updated_at timestamptz,
  target_request_data jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  new_request_id uuid;
begin
  insert into public.process_workflow_requests (
    organization_id,
    process_id,
    requested_by,
    action,
    reason,
    assurance_tier,
    required_approvals,
    process_updated_at,
    request_data
  )
  values (
    target_organization,
    target_process,
    requesting_user,
    target_action,
    trim(target_reason),
    target_tier,
    private.required_process_approvals(target_tier),
    target_process_updated_at,
    coalesce(target_request_data, '{}'::jsonb)
  )
  returning id into new_request_id;

  return new_request_id;
end;
$function$;

create or replace function public.submit_process_for_approval(target_process uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := private.current_app_user_id();
  process_row public.voting_processes%rowtype;
  organization_id uuid;
  request_id uuid;
  new_updated_at timestamptz;
begin
  if caller_id is null then
    raise exception 'Authenticated application identity is required' using errcode = '28000';
  end if;

  select p, e.organization_id
  into process_row, organization_id
  from public.voting_processes p
  join public.voting_events e on e.id = p.event_id
  where p.id = target_process
  for update of p;

  if not found then
    raise exception 'Voting process not found' using errcode = 'P0002';
  end if;

  if not (
    private.has_org_role(organization_id, array['OWNER','ADMIN']::public.organization_member_role[])
    or private.has_process_permission(target_process, 'process.submit')
  ) then
    raise exception 'Insufficient permission to submit this process' using errcode = '42501';
  end if;

  if process_row.status <> 'DRAFT' then
    raise exception 'Only draft processes can be submitted' using errcode = '22023';
  end if;

  if process_row.opens_at is null
     or process_row.closes_at is null
     or process_row.opens_at <= now()
     or process_row.closes_at <= process_row.opens_at then
    raise exception 'A valid future opening and closing schedule is required' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.contests c
    join public.ballot_items b on b.contest_id = c.id
    where c.process_id = target_process
  ) then
    raise exception 'At least one contest with a ballot item is required' using errcode = '22023';
  end if;

  update public.voting_processes
  set status = 'PENDING_APPROVAL', updated_at = now()
  where id = target_process
  returning updated_at into new_updated_at;

  request_id := private.create_process_workflow_request(
    organization_id,
    target_process,
    caller_id,
    'APPROVE_PROCESS',
    'Process submitted for approval',
    process_row.assurance_tier,
    new_updated_at,
    jsonb_build_object('submitted_from', 'DRAFT')
  );

  insert into public.process_lifecycle_events (
    organization_id, process_id, actor_user_id, action,
    from_status, to_status, reason, workflow_request_id
  )
  values (
    organization_id, target_process, caller_id, 'SUBMITTED_FOR_APPROVAL',
    'DRAFT', 'PENDING_APPROVAL', 'Process submitted for approval', request_id
  );

  insert into public.audit_events (
    organization_id, actor_user_id, action, resource_type, resource_id, event_data
  )
  values (
    organization_id, caller_id, 'PROCESS_SUBMITTED_FOR_APPROVAL',
    'voting_process', target_process::text,
    jsonb_build_object('workflow_request_id', request_id, 'assurance_tier', process_row.assurance_tier)
  );

  return request_id;
end;
$function$;

create or replace function public.emergency_suspend_process(
  target_process uuid,
  reason text,
  evidence jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := private.current_app_user_id();
  process_row public.voting_processes%rowtype;
  organization_id uuid;
  lifecycle_event_id uuid;
begin
  if caller_id is null then
    raise exception 'Authenticated application identity is required' using errcode = '28000';
  end if;

  if reason is null or length(trim(reason)) < 10 or length(trim(reason)) > 2000 then
    raise exception 'A suspension reason of 10 to 2000 characters is required' using errcode = '22023';
  end if;

  select p, e.organization_id
  into process_row, organization_id
  from public.voting_processes p
  join public.voting_events e on e.id = p.event_id
  where p.id = target_process
  for update of p;

  if not found then
    raise exception 'Voting process not found' using errcode = 'P0002';
  end if;

  if not private.has_org_role(
    organization_id,
    array['OWNER','ADMIN']::public.organization_member_role[]
  ) then
    raise exception 'Only an active organization OWNER or ADMIN can emergency-suspend a process' using errcode = '42501';
  end if;

  if process_row.status <> 'OPEN' then
    raise exception 'Only an open voting process can be emergency-suspended' using errcode = '22023';
  end if;

  update public.voting_processes
  set status = 'SUSPENDED', updated_at = now()
  where id = target_process;

  insert into public.process_lifecycle_events (
    organization_id, process_id, actor_user_id, action,
    from_status, to_status, reason, evidence
  )
  values (
    organization_id, target_process, caller_id, 'EMERGENCY_SUSPENDED',
    process_row.status, 'SUSPENDED', trim(reason), coalesce(evidence, '{}'::jsonb)
  )
  returning id into lifecycle_event_id;

  insert into public.audit_events (
    organization_id, actor_user_id, action, resource_type, resource_id, event_data
  )
  values (
    organization_id, caller_id, 'PROCESS_EMERGENCY_SUSPENDED',
    'voting_process', target_process::text,
    jsonb_build_object('lifecycle_event_id', lifecycle_event_id, 'reason', trim(reason))
  );

  return lifecycle_event_id;
end;
$function$;

create or replace function public.request_process_resumption(
  target_process uuid,
  reason text,
  review_outcome text,
  corrective_actions jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := private.current_app_user_id();
  process_row public.voting_processes%rowtype;
  organization_id uuid;
  request_id uuid;
begin
  if caller_id is null then
    raise exception 'Authenticated application identity is required' using errcode = '28000';
  end if;

  if reason is null or length(trim(reason)) < 10 or length(trim(reason)) > 2000
     or review_outcome is null or length(trim(review_outcome)) < 10
     or jsonb_typeof(coalesce(corrective_actions, '[]'::jsonb)) <> 'array' then
    raise exception 'A reason, documented review outcome and corrective-actions array are required' using errcode = '22023';
  end if;

  select p, e.organization_id
  into process_row, organization_id
  from public.voting_processes p
  join public.voting_events e on e.id = p.event_id
  where p.id = target_process
  for update of p;

  if not found then
    raise exception 'Voting process not found' using errcode = 'P0002';
  end if;

  if not private.has_org_role(
    organization_id,
    array['OWNER','ADMIN']::public.organization_member_role[]
  ) then
    raise exception 'Only an active organization OWNER or ADMIN can request resumption' using errcode = '42501';
  end if;

  if process_row.status <> 'SUSPENDED' then
    raise exception 'Only suspended processes can be resumed' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.process_lifecycle_events l
    where l.process_id = target_process
      and l.action = 'EMERGENCY_SUSPENDED'
      and l.to_status = 'SUSPENDED'
  ) then
    raise exception 'No emergency suspension record exists for this process' using errcode = '22023';
  end if;

  request_id := private.create_process_workflow_request(
    organization_id,
    target_process,
    caller_id,
    'RESUME_PROCESS',
    trim(reason),
    process_row.assurance_tier,
    process_row.updated_at,
    jsonb_build_object(
      'review_outcome', trim(review_outcome),
      'corrective_actions', coalesce(corrective_actions, '[]'::jsonb)
    )
  );

  insert into public.audit_events (
    organization_id, actor_user_id, action, resource_type, resource_id, event_data
  )
  values (
    organization_id, caller_id, 'PROCESS_RESUMPTION_REQUESTED',
    'voting_process', target_process::text,
    jsonb_build_object('workflow_request_id', request_id, 'assurance_tier', process_row.assurance_tier)
  );

  return request_id;
end;
$function$;

create or replace function public.request_process_termination(
  target_process uuid,
  reason text,
  evidence jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := private.current_app_user_id();
  process_row public.voting_processes%rowtype;
  organization_id uuid;
  request_id uuid;
begin
  if caller_id is null then
    raise exception 'Authenticated application identity is required' using errcode = '28000';
  end if;

  if reason is null or length(trim(reason)) < 10 or length(trim(reason)) > 2000 then
    raise exception 'A termination reason of 10 to 2000 characters is required' using errcode = '22023';
  end if;

  select p, e.organization_id
  into process_row, organization_id
  from public.voting_processes p
  join public.voting_events e on e.id = p.event_id
  where p.id = target_process
  for update of p;

  if not found then
    raise exception 'Voting process not found' using errcode = 'P0002';
  end if;

  if not private.has_org_role(
    organization_id,
    array['OWNER','ADMIN']::public.organization_member_role[]
  ) then
    raise exception 'Only an active organization OWNER or ADMIN can request termination' using errcode = '42501';
  end if;

  if process_row.status = 'OPEN' then
    raise exception 'Open processes must be emergency-suspended before termination' using errcode = '22023';
  end if;

  if process_row.status in ('CERTIFIED', 'TERMINATED') then
    raise exception 'Certified or already terminated processes cannot be terminated' using errcode = '22023';
  end if;

  request_id := private.create_process_workflow_request(
    organization_id,
    target_process,
    caller_id,
    'TERMINATE_PROCESS',
    trim(reason),
    process_row.assurance_tier,
    process_row.updated_at,
    coalesce(evidence, '{}'::jsonb)
  );

  insert into public.audit_events (
    organization_id, actor_user_id, action, resource_type, resource_id, event_data
  )
  values (
    organization_id, caller_id, 'PROCESS_TERMINATION_REQUESTED',
    'voting_process', target_process::text,
    jsonb_build_object('workflow_request_id', request_id, 'assurance_tier', process_row.assurance_tier)
  );

  return request_id;
end;
$function$;


create or replace function public.open_scheduled_process(target_process uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := private.current_app_user_id();
  process_row public.voting_processes%rowtype;
  organization_id uuid;
  lifecycle_event_id uuid;
begin
  if caller_id is null then
    raise exception 'Authenticated application identity is required' using errcode = '28000';
  end if;

  select p, e.organization_id
  into process_row, organization_id
  from public.voting_processes p
  join public.voting_events e on e.id = p.event_id
  where p.id = target_process
  for update of p;

  if not found then
    raise exception 'Voting process not found' using errcode = 'P0002';
  end if;

  if not private.has_org_role(
    organization_id,
    array['OWNER','ADMIN']::public.organization_member_role[]
  ) then
    raise exception 'Only an active organization OWNER or ADMIN can open a scheduled process' using errcode = '42501';
  end if;

  if process_row.status <> 'SCHEDULED'
     or process_row.opens_at is null
     or process_row.closes_at is null
     or process_row.opens_at > now()
     or process_row.closes_at <= now() then
    raise exception 'Process is not within its approved opening window' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.process_workflow_requests r
    where r.process_id = target_process and r.status = 'PENDING'
  ) then
    raise exception 'A pending governance request must be resolved before opening' using errcode = '22023';
  end if;

  update public.voting_processes
  set status = 'OPEN', updated_at = now()
  where id = target_process;

  insert into public.process_lifecycle_events (
    organization_id, process_id, actor_user_id, action,
    from_status, to_status, reason
  )
  values (
    organization_id, target_process, caller_id, 'PROCESS_OPENED',
    'SCHEDULED', 'OPEN', 'Approved schedule reached; process opened by an authorized manager.'
  )
  returning id into lifecycle_event_id;

  insert into public.audit_events (
    organization_id, actor_user_id, action, resource_type, resource_id, event_data
  )
  values (
    organization_id, caller_id, 'PROCESS_OPENED',
    'voting_process', target_process::text,
    jsonb_build_object('lifecycle_event_id', lifecycle_event_id, 'opens_at', process_row.opens_at)
  );

  return lifecycle_event_id;
end;
$function$;

create or replace function public.close_expired_process(target_process uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := private.current_app_user_id();
  process_row public.voting_processes%rowtype;
  organization_id uuid;
  lifecycle_event_id uuid;
begin
  if caller_id is null then
    raise exception 'Authenticated application identity is required' using errcode = '28000';
  end if;

  select p, e.organization_id
  into process_row, organization_id
  from public.voting_processes p
  join public.voting_events e on e.id = p.event_id
  where p.id = target_process
  for update of p;

  if not found then
    raise exception 'Voting process not found' using errcode = 'P0002';
  end if;

  if not private.has_org_role(
    organization_id,
    array['OWNER','ADMIN']::public.organization_member_role[]
  ) then
    raise exception 'Only an active organization OWNER or ADMIN can close an expired process' using errcode = '42501';
  end if;

  if process_row.status not in ('SCHEDULED', 'OPEN')
     or process_row.closes_at is null
     or process_row.closes_at > now() then
    raise exception 'Process has not reached its approved closing time' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.process_workflow_requests r
    where r.process_id = target_process and r.status = 'PENDING'
  ) then
    raise exception 'A pending governance request must be resolved before closing' using errcode = '22023';
  end if;

  update public.voting_processes
  set status = 'CLOSED', updated_at = now()
  where id = target_process;

  insert into public.process_lifecycle_events (
    organization_id, process_id, actor_user_id, action,
    from_status, to_status, reason
  )
  values (
    organization_id, target_process, caller_id,
    case when process_row.status = 'OPEN' then 'PROCESS_CLOSED' else 'PROCESS_WINDOW_EXPIRED' end,
    process_row.status, 'CLOSED',
    'Approved closing time reached; process closed by an authorized manager.'
  )
  returning id into lifecycle_event_id;

  insert into public.audit_events (
    organization_id, actor_user_id, action, resource_type, resource_id, event_data
  )
  values (
    organization_id, caller_id, 'PROCESS_CLOSED',
    'voting_process', target_process::text,
    jsonb_build_object('lifecycle_event_id', lifecycle_event_id, 'closes_at', process_row.closes_at)
  );

  return lifecycle_event_id;
end;
$function$;

create or replace function public.approve_process_workflow_request(
  target_request uuid,
  decision text,
  comment text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := private.current_app_user_id();
  request_row public.process_workflow_requests%rowtype;
  process_row public.voting_processes%rowtype;
  approval_count integer;
  resulting_status public.process_status;
  lifecycle_action text;
  suspension_event_id uuid;
begin
  if caller_id is null then
    raise exception 'Authenticated application identity is required' using errcode = '28000';
  end if;

  if decision is null or decision not in ('APPROVE', 'REJECT') then
    raise exception 'Decision must be APPROVE or REJECT' using errcode = '22023';
  end if;

  select * into request_row
  from public.process_workflow_requests
  where id = target_request
  for update;

  if not found then
    raise exception 'Workflow request not found' using errcode = 'P0002';
  end if;

  if request_row.status <> 'PENDING' then
    raise exception 'Workflow request is no longer pending' using errcode = '22023';
  end if;

  if caller_id = request_row.requested_by then
    raise exception 'The requester cannot approve their own operation' using errcode = '42501';
  end if;

  if not private.has_org_role(
    request_row.organization_id,
    array['OWNER','ADMIN']::public.organization_member_role[]
  ) then
    raise exception 'Only active organization OWNERs and ADMINs can approve this operation' using errcode = '42501';
  end if;

  select * into process_row
  from public.voting_processes
  where id = request_row.process_id
  for update;

  if not found then
    raise exception 'Voting process not found' using errcode = 'P0002';
  end if;

  if process_row.updated_at is distinct from request_row.process_updated_at
     or (
       request_row.action = 'APPROVE_PROCESS'
       and (
         process_row.opens_at is null
         or process_row.closes_at is null
         or process_row.opens_at <= now()
         or process_row.closes_at <= process_row.opens_at
       )
     ) then
    if request_row.action = 'APPROVE_PROCESS'
       and process_row.status = 'PENDING_APPROVAL' then
      update public.voting_processes
      set status = 'DRAFT', updated_at = now()
      where id = request_row.process_id;

      insert into public.process_lifecycle_events (
        organization_id, process_id, actor_user_id, action,
        from_status, to_status, reason, workflow_request_id
      )
      values (
        request_row.organization_id, request_row.process_id, caller_id,
        'PROCESS_APPROVAL_REQUEST_CANCELLED_STALE',
        'PENDING_APPROVAL', 'DRAFT',
        'Approval request became stale or its schedule expired; revise and resubmit.',
        target_request
      );
    end if;

    update public.process_workflow_requests
    set status = 'CANCELLED', resolved_at = now()
    where id = target_request;

    insert into public.audit_events (
      organization_id, actor_user_id, action, resource_type, resource_id, event_data
    )
    values (
      request_row.organization_id, caller_id, 'PROCESS_WORKFLOW_REQUEST_CANCELLED_STALE',
      'process_workflow_request', target_request::text,
      jsonb_build_object('process_id', request_row.process_id, 'action', request_row.action)
    );

    return target_request;
  end if;

  insert into public.process_workflow_approvals (
    request_id, approver_user_id, decision, comment
  )
  values (target_request, caller_id, decision, nullif(trim(comment), ''));

  insert into public.audit_events (
    organization_id, actor_user_id, action, resource_type, resource_id, event_data
  )
  values (
    request_row.organization_id, caller_id, 'PROCESS_WORKFLOW_APPROVAL_RECORDED',
    'process_workflow_request', target_request::text,
    jsonb_build_object(
      'process_id', request_row.process_id,
      'action', request_row.action,
      'decision', decision,
      'assurance_tier', request_row.assurance_tier
    )
  );

  if decision = 'REJECT' then
    if request_row.action = 'APPROVE_PROCESS'
       and process_row.status = 'PENDING_APPROVAL' then
      update public.voting_processes
      set status = 'DRAFT', updated_at = now()
      where id = request_row.process_id;

      insert into public.process_lifecycle_events (
        organization_id, process_id, actor_user_id, action,
        from_status, to_status, reason, workflow_request_id
      )
      values (
        request_row.organization_id, request_row.process_id, caller_id,
        'PROCESS_APPROVAL_REJECTED',
        'PENDING_APPROVAL', 'DRAFT',
        coalesce(nullif(trim(comment), ''), 'Process approval was rejected; revise and resubmit.'),
        target_request
      );
    end if;

    update public.process_workflow_requests
    set status = 'REJECTED', resolved_at = now()
    where id = target_request;

    insert into public.audit_events (
      organization_id, actor_user_id, action, resource_type, resource_id, event_data
    )
    values (
      request_row.organization_id, caller_id, 'PROCESS_WORKFLOW_REQUEST_REJECTED',
      'process_workflow_request', target_request::text,
      jsonb_build_object('process_id', request_row.process_id, 'action', request_row.action)
    );

    return target_request;
  end if;

  select count(*) into approval_count
  from public.process_workflow_approvals
  where request_id = target_request
    and decision = 'APPROVE';

  if approval_count < request_row.required_approvals then
    return target_request;
  end if;

  if request_row.action = 'APPROVE_PROCESS' then
    if process_row.status <> 'PENDING_APPROVAL'
       or process_row.opens_at is null
       or process_row.closes_at is null
       or process_row.opens_at <= now()
       or process_row.closes_at <= process_row.opens_at then
      raise exception 'Process is no longer eligible for approval and scheduling' using errcode = '22023';
    end if;

    resulting_status := 'SCHEDULED';
    lifecycle_action := 'PROCESS_APPROVED_AND_SCHEDULED';

  elsif request_row.action = 'RESUME_PROCESS' then
    if process_row.status <> 'SUSPENDED'
       or process_row.opens_at is null
       or process_row.closes_at is null then
      raise exception 'Process is no longer eligible for resumption' using errcode = '22023';
    end if;

    select id into suspension_event_id
    from public.process_lifecycle_events
    where process_id = request_row.process_id
      and action = 'EMERGENCY_SUSPENDED'
      and to_status = 'SUSPENDED'
    order by occurred_at desc
    limit 1;

    if suspension_event_id is null then
      raise exception 'Emergency suspension evidence is missing' using errcode = '22023';
    end if;

    if now() < process_row.opens_at then
      resulting_status := 'SCHEDULED';
    elsif now() < process_row.closes_at then
      resulting_status := 'OPEN';
    else
      resulting_status := 'CLOSED';
    end if;

    lifecycle_action := 'PROCESS_RESUMED';

  elsif request_row.action = 'TERMINATE_PROCESS' then
    if process_row.status in ('OPEN', 'CERTIFIED', 'TERMINATED') then
      raise exception 'Process is no longer eligible for termination' using errcode = '22023';
    end if;

    resulting_status := 'TERMINATED';
    lifecycle_action := 'PROCESS_TERMINATED';

  else
    raise exception 'Unsupported workflow action' using errcode = '22023';
  end if;

  update public.voting_processes
  set status = resulting_status, updated_at = now()
  where id = request_row.process_id;

  insert into public.process_lifecycle_events (
    organization_id, process_id, actor_user_id, action,
    from_status, to_status, reason, evidence, workflow_request_id
  )
  values (
    request_row.organization_id,
    request_row.process_id,
    caller_id,
    lifecycle_action,
    process_row.status,
    resulting_status,
    request_row.reason,
    request_row.request_data,
    target_request
  );

  update public.process_workflow_requests
  set status = 'APPROVED', resolved_at = now()
  where id = target_request;

  insert into public.audit_events (
    organization_id, actor_user_id, action, resource_type, resource_id, event_data
  )
  values (
    request_row.organization_id, caller_id, lifecycle_action,
    'voting_process', request_row.process_id::text,
    jsonb_build_object(
      'workflow_request_id', target_request,
      'assurance_tier', request_row.assurance_tier,
      'required_approvals', request_row.required_approvals,
      'approval_count', approval_count,
      'from_status', process_row.status,
      'to_status', resulting_status
    )
  );

  return target_request;
end;
$function$;

revoke all on function private.assurance_tier_rank(public.assurance_tier) from public, anon, authenticated;
revoke all on function private.enforce_process_assurance_floor() from public, anon, authenticated;
revoke all on function private.propagate_event_assurance_floor() from public, anon, authenticated;
revoke all on function private.required_process_approvals(public.assurance_tier) from public, anon, authenticated;
revoke all on function private.create_process_workflow_request(uuid, uuid, uuid, text, text, public.assurance_tier, timestamptz, jsonb) from public, anon, authenticated;

revoke all on function public.open_scheduled_process(uuid) from public, anon;
revoke all on function public.close_expired_process(uuid) from public, anon;
grant execute on function public.open_scheduled_process(uuid) to authenticated;
grant execute on function public.close_expired_process(uuid) to authenticated;

revoke all on function public.submit_process_for_approval(uuid) from public, anon;
revoke all on function public.emergency_suspend_process(uuid, text, jsonb) from public, anon;
revoke all on function public.request_process_resumption(uuid, text, text, jsonb) from public, anon;
revoke all on function public.request_process_termination(uuid, text, jsonb) from public, anon;
revoke all on function public.approve_process_workflow_request(uuid, text, text) from public, anon;

grant execute on function public.submit_process_for_approval(uuid) to authenticated;
grant execute on function public.emergency_suspend_process(uuid, text, jsonb) to authenticated;
grant execute on function public.request_process_resumption(uuid, text, text, jsonb) to authenticated;
grant execute on function public.request_process_termination(uuid, text, jsonb) to authenticated;
grant execute on function public.approve_process_workflow_request(uuid, text, text) to authenticated;

create type public.payment_transaction_status as enum (
  'INITIALIZING', 'PENDING', 'SUCCEEDED', 'FAILED', 'ABANDONED', 'REFUNDED'
);

create table public.payment_transactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  initiated_by uuid not null references public.app_users(id) on delete restrict,
  provider text not null default 'PAYSTACK' check (provider = 'PAYSTACK'),
  provider_reference text not null unique check (length(trim(provider_reference)) between 8 and 120),
  idempotency_key text not null check (length(trim(idempotency_key)) between 8 and 128),
  provider_transaction_id text,
  price_code text not null check (length(trim(price_code)) between 1 and 100),
  amount_minor bigint not null check (amount_minor > 0),
  currency character(3) not null check (currency ~ '^[A-Z]{3}$'),
  status public.payment_transaction_status not null default 'INITIALIZING',
  checkout_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  verified_at timestamptz
);

alter table public.payment_transactions
  add constraint payment_transactions_org_idempotency_key
  unique (organization_id, idempotency_key);

create index payment_transactions_org_created_idx
  on public.payment_transactions(organization_id, created_at desc);
create index payment_transactions_status_created_idx
  on public.payment_transactions(status, created_at);

alter table public.payment_transactions enable row level security;
revoke all on public.payment_transactions from public, anon, authenticated;
grant select on public.payment_transactions to authenticated;
grant all on public.payment_transactions to service_role;

create policy "billing roles can read organization payments"
on public.payment_transactions for select to authenticated
using (
  private.has_org_role(
    organization_id,
    array['OWNER','ADMIN','BILLING_MANAGER']::public.organization_member_role[]
  )
);

create table public.payment_webhook_events (
  event_key text primary key,
  provider text not null default 'PAYSTACK' check (provider = 'PAYSTACK'),
  event_type text not null,
  provider_reference text,
  event_data jsonb not null default '{}'::jsonb,
  status text not null default 'RECEIVED'
    check (status in ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error text,
  next_attempt_at timestamptz,
  processing_started_at timestamptz,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  updated_at timestamptz not null default now()
);

create index payment_webhook_events_retry_idx
  on public.payment_webhook_events(status, next_attempt_at, received_at);

alter table public.payment_webhook_events enable row level security;
revoke all on public.payment_webhook_events from public, anon, authenticated;
grant all on public.payment_webhook_events to service_role;


create or replace function public.claim_paystack_webhook_event(target_event_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  claimed_event public.payment_webhook_events%rowtype;
begin
  if (select auth.jwt() ->> 'role') is distinct from 'service_role' then
    raise exception 'Service role is required' using errcode = '42501';
  end if;

  update public.payment_webhook_events
  set status = 'PROCESSING',
      attempt_count = attempt_count + 1,
      processing_started_at = now(),
      updated_at = now()
  where event_key = target_event_key
    and attempt_count < 5
    and (
      status = 'RECEIVED'
      or (status = 'FAILED' and next_attempt_at is not null and next_attempt_at <= now())
      or (status = 'PROCESSING' and processing_started_at < now() - interval '10 minutes')
    )
  returning * into claimed_event;

  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'event_key', claimed_event.event_key,
    'event_type', claimed_event.event_type,
    'provider_reference', claimed_event.provider_reference,
    'event_data', claimed_event.event_data
  );
end;
$function$;

create or replace function public.fail_paystack_webhook_event(
  target_event_key text,
  error_message text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if (select auth.jwt() ->> 'role') is distinct from 'service_role' then
    raise exception 'Service role is required' using errcode = '42501';
  end if;

  update public.payment_webhook_events
  set status = 'FAILED',
      last_error = left(coalesce(error_message, 'Unknown processing error'), 500),
      next_attempt_at = case
        when attempt_count < 5 then now() + interval '5 minutes'
        else null
      end,
      processing_started_at = null,
      updated_at = now()
  where event_key = target_event_key
    and status = 'PROCESSING';

  return found;
end;
$function$;

create or replace function public.complete_paystack_payment(
  target_reference text,
  target_amount_minor bigint,
  target_currency text,
  target_provider_transaction_id text,
  target_event_key text,
  target_event_type text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  payment_row public.payment_transactions%rowtype;
begin
  if (select auth.jwt() ->> 'role') is distinct from 'service_role' then
    raise exception 'Service role is required' using errcode = '42501';
  end if;

  select * into payment_row
  from public.payment_transactions
  where provider_reference = target_reference
  for update;

  if not found then
    update public.payment_webhook_events
    set status = 'FAILED',
        last_error = 'No payment ledger row matches the verified Paystack reference.',
        next_attempt_at = null,
        processing_started_at = null,
        updated_at = now()
    where event_key = target_event_key;
    return false;
  end if;

  if payment_row.amount_minor <> target_amount_minor
     or payment_row.currency <> target_currency then
    update public.payment_webhook_events
    set status = 'FAILED',
        last_error = 'Verified Paystack amount or currency does not match the payment ledger.',
        next_attempt_at = null,
        processing_started_at = null,
        updated_at = now()
    where event_key = target_event_key;
    return false;
  end if;

  if payment_row.status = 'SUCCEEDED' then
    update public.payment_webhook_events
    set status = 'PROCESSED',
        processed_at = coalesce(processed_at, now()),
        last_error = null,
        next_attempt_at = null,
        processing_started_at = null,
        updated_at = now()
    where event_key = target_event_key;
    return true;
  end if;

  if payment_row.status not in ('INITIALIZING', 'PENDING') then
    update public.payment_webhook_events
    set status = 'FAILED',
        last_error = 'Payment ledger is not in a state that can be settled.',
        next_attempt_at = null,
        processing_started_at = null,
        updated_at = now()
    where event_key = target_event_key;
    return false;
  end if;

  update public.payment_transactions
  set status = 'SUCCEEDED',
      provider_transaction_id = target_provider_transaction_id,
      verified_at = now(),
      updated_at = now()
  where id = payment_row.id;

  update public.payment_webhook_events
  set status = 'PROCESSED',
      processed_at = now(),
      last_error = null,
      next_attempt_at = null,
      processing_started_at = null,
      updated_at = now()
  where event_key = target_event_key;

  insert into public.audit_events (
    organization_id, actor_user_id, action, resource_type, resource_id, event_data
  )
  values (
    payment_row.organization_id, null, 'PAYMENT_SUCCEEDED',
    'payment_transaction', payment_row.id::text,
    jsonb_build_object(
      'provider', 'PAYSTACK',
      'provider_reference', target_reference,
      'amount_minor', payment_row.amount_minor,
      'currency', payment_row.currency,
      'price_code', payment_row.price_code
    )
  );

  return true;
end;
$function$;

revoke all on function public.claim_paystack_webhook_event(text) from public, anon, authenticated;
revoke all on function public.fail_paystack_webhook_event(text, text) from public, anon, authenticated;
revoke all on function public.complete_paystack_payment(text, bigint, text, text, text, text) from public, anon, authenticated;
grant execute on function public.claim_paystack_webhook_event(text) to service_role;
grant execute on function public.fail_paystack_webhook_event(text, text) to service_role;
grant execute on function public.complete_paystack_payment(text, bigint, text, text, text, text) to service_role;

comment on table public.process_lifecycle_events is
  'Append-only process lifecycle evidence. Ballot contents and voter-to-ballot linkage must never be stored here.';
comment on table public.process_workflow_requests is
  'Assurance-tiered governance requests for process approval, resumption and termination.';
comment on table public.payment_transactions is
  'Organization platform-billing ledger. Payments are not evidence of voter eligibility or ballot submission.';
comment on table public.payment_webhook_events is
  'Minimal idempotency ledger for verified Paystack webhook deliveries; raw webhook bodies are not stored.';
