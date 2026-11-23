-- Versioned, approval-backed voter-register finalization.
-- All register mutations and snapshot decisions serialize on the voting_processes row.
-- Snapshot identity payloads are retained internally; they are never exposed through the Data API.

alter table public.voting_processes
  add column voter_register_revision bigint not null default 0
  check (voter_register_revision >= 0);

create table public.voter_register_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  event_id uuid not null references public.voting_events(id) on delete restrict,
  process_id uuid not null references public.voting_processes(id) on delete restrict,
  version integer not null check (version > 0),
  status text not null default 'PENDING_APPROVAL'
    check (status in ('PENDING_APPROVAL','FINALIZED','REJECTED','STALE','REOPENED')),
  requested_by uuid not null references public.app_users(id) on delete restrict,
  assurance_tier public.assurance_tier not null,
  required_approvals smallint not null check (required_approvals between 1 and 3),
  register_revision bigint not null check (register_revision >= 0),
  total_entry_count integer not null check (total_entry_count >= 0),
  eligible_count integer not null check (eligible_count > 0),
  rejected_count integer not null check (rejected_count >= 0),
  revoked_count integer not null check (revoked_count >= 0),
  integrity_digest text not null check (integrity_digest ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  finalized_at timestamptz,
  resolved_at timestamptz,
  reopened_at timestamptz,
  reopened_by uuid references public.app_users(id) on delete restrict,
  reopen_reason text,
  unique (process_id, version),
  check (status <> 'FINALIZED' or finalized_at is not null),
  check (
    status <> 'REOPENED'
    or (reopened_at is not null and reopened_by is not null and reopen_reason is not null)
  )
);

create unique index voter_register_one_active_snapshot_per_process
  on public.voter_register_snapshots(process_id)
  where status in ('PENDING_APPROVAL','FINALIZED');

create index voter_register_snapshots_process_history_idx
  on public.voter_register_snapshots(process_id, version desc);

create table public.voter_register_snapshot_entries (
  snapshot_id uuid not null references public.voter_register_snapshots(id) on delete restrict,
  voter_register_entry_id uuid not null references public.voter_register_entries(id) on delete restrict,
  ordinal integer not null check (ordinal > 0),
  eligibility_status text not null
    check (eligibility_status in ('ELIGIBLE','REJECTED','REVOKED')),
  identity_payload jsonb not null,
  primary key (snapshot_id, voter_register_entry_id),
  unique (snapshot_id, ordinal)
);

create index voter_register_snapshot_entries_voter_idx
  on public.voter_register_snapshot_entries(voter_register_entry_id);

create table public.voter_register_snapshot_approvals (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.voter_register_snapshots(id) on delete restrict,
  approver_user_id uuid not null references public.app_users(id) on delete restrict,
  decision text not null check (decision in ('APPROVE','REJECT')),
  comment text check (comment is null or length(trim(comment)) <= 1000),
  decided_at timestamptz not null default now(),
  unique (snapshot_id, approver_user_id)
);

create index voter_register_snapshot_approvals_snapshot_idx
  on public.voter_register_snapshot_approvals(snapshot_id, decided_at);

alter table public.voter_register_snapshots enable row level security;
alter table public.voter_register_snapshot_entries enable row level security;
alter table public.voter_register_snapshot_approvals enable row level security;

revoke all on public.voter_register_snapshots from public, anon, authenticated;
revoke all on public.voter_register_snapshot_entries from public, anon, authenticated;
revoke all on public.voter_register_snapshot_approvals from public, anon, authenticated;
grant select on public.voter_register_snapshots to authenticated;
grant select on public.voter_register_snapshot_approvals to authenticated;

create policy "authorized process members can read register snapshot metadata"
on public.voter_register_snapshots for select to authenticated
using (
  private.has_org_role(
    organization_id,
    array['OWNER','ADMIN']::public.organization_member_role[]
  )
  or private.has_process_permission(process_id, 'process.read')
);

create policy "organization governors can read register snapshot approvals"
on public.voter_register_snapshot_approvals for select to authenticated
using (
  exists (
    select 1 from public.voter_register_snapshots s
    where s.id = snapshot_id
      and private.has_org_role(
        s.organization_id,
        array['OWNER','ADMIN']::public.organization_member_role[]
      )
  )
);

-- This table contains copied voter PII for historical integrity. No API role receives
-- table privileges, and there is deliberately no SELECT policy.
revoke all on public.voter_register_snapshot_entries from public, anon, authenticated;

create or replace function private.guard_finalized_voter_register_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  target_process uuid;
begin
  if tg_op = 'UPDATE' and old.process_id <> new.process_id then
    raise exception 'A voter register entry cannot be moved between processes'
      using errcode = '22023';
  end if;

  if tg_op = 'DELETE' then
    target_process := old.process_id;
  else
    target_process := new.process_id;
  end if;

  perform 1
  from public.voting_processes p
  where p.id = target_process
  for update;

  if not found then
    raise exception 'Voting process not found for voter register entry'
      using errcode = '23503';
  end if;

  if exists (
    select 1
    from public.voter_register_snapshots s
    where s.process_id = target_process
      and s.status = 'FINALIZED'
  ) then
    raise exception 'The voter register is finalized; request an audited reopening before changing it'
      using errcode = '42501';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;

create or replace function private.track_voter_register_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  target_process uuid;
begin
  if tg_op = 'DELETE' then
    target_process := old.process_id;
  else
    target_process := new.process_id;
  end if;

  update public.voting_processes
  set voter_register_revision = voter_register_revision + 1
  where id = target_process;

  update public.voter_register_snapshots
  set status = 'STALE', resolved_at = now()
  where process_id = target_process
    and status = 'PENDING_APPROVAL';

  return null;
end;
$function$;

create trigger voter_register_finalized_mutation_guard
before insert or update or delete on public.voter_register_entries
for each row execute function private.guard_finalized_voter_register_mutation();

create trigger voter_register_revision_tracker
after insert or update or delete on public.voter_register_entries
for each row execute function private.track_voter_register_revision();

create or replace function public.request_voter_register_finalization(
  target_process uuid,
  target_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := private.current_app_user_id();
  process_row public.voting_processes%rowtype;
  target_organization uuid;
  target_event uuid;
  total_count integer;
  eligible_count integer;
  rejected_count integer;
  revoked_count integer;
  pending_count integer;
  duplicate_reference_count integer;
  snapshot_version integer;
  payload text;
  snapshot_digest text;
  snapshot_id uuid;
begin
  if caller_id is null then
    raise exception 'Authenticated application identity is required' using errcode = '28000';
  end if;
  if target_reason is null or length(trim(target_reason)) < 10 or length(trim(target_reason)) > 1000 then
    raise exception 'A reason between 10 and 1000 characters is required' using errcode = '22023';
  end if;

  -- The process row is the serialization lock shared with all register mutations.
  select p.* into process_row
  from public.voting_processes p
  where p.id = target_process
  for update;
  if not found then
    raise exception 'Voting process not found' using errcode = 'P0002';
  end if;

  select e.organization_id, e.id
  into target_organization, target_event
  from public.voting_events e
  where e.id = process_row.event_id;

  if process_row.status <> 'DRAFT'
     or process_row.eligibility_mode not in ('MANAGED_REGISTER','COMBINED')
     or not private.can_manage_draft_voter_register(target_process) then
    raise exception 'Only authorized managers can finalize a managed register on a draft process'
      using errcode = '42501';
  end if;

  if exists (
    select 1 from public.voter_register_snapshots s
    where s.process_id = target_process
      and s.status in ('PENDING_APPROVAL','FINALIZED')
  ) then
    raise exception 'This process already has a pending or finalized register snapshot'
      using errcode = '23505';
  end if;

  select
    count(*)::integer,
    count(*) filter (where eligibility_status = 'ELIGIBLE')::integer,
    count(*) filter (where eligibility_status = 'REJECTED')::integer,
    count(*) filter (where eligibility_status = 'REVOKED')::integer,
    count(*) filter (where eligibility_status = 'PENDING')::integer
  into total_count, eligible_count, rejected_count, revoked_count, pending_count
  from public.voter_register_entries
  where process_id = target_process;

  if total_count = 0 or eligible_count = 0 then
    raise exception 'A register must contain at least one eligible voter before finalization'
      using errcode = '22023';
  end if;
  if pending_count > 0 then
    raise exception 'All pending eligibility reviews must be resolved before finalization'
      using errcode = '22023';
  end if;

  select count(*)::integer into duplicate_reference_count
  from (
    select lower(trim(external_reference))
    from public.voter_register_entries
    where process_id = target_process
      and eligibility_status = 'ELIGIBLE'
      and external_reference is not null
      and length(trim(external_reference)) > 0
    group by lower(trim(external_reference))
    having count(*) > 1
  ) duplicates;
  if duplicate_reference_count > 0 then
    raise exception 'Duplicate external references among eligible voters must be resolved before finalization'
      using errcode = '22023';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', v.id,
        'external_reference', v.external_reference,
        'display_name', v.display_name,
        'contact_email', v.contact_email,
        'contact_phone', v.contact_phone,
        'eligibility_status', v.eligibility_status,
        'source', v.source,
        'created_at', v.created_at
      ) order by v.id
    )::text,
    '[]'
  )
  into payload
  from public.voter_register_entries v
  where v.process_id = target_process;

  snapshot_digest := encode(
    extensions.digest(convert_to(payload, 'UTF8'), 'sha256'),
    'hex'
  );

  select coalesce(max(version), 0) + 1 into snapshot_version
  from public.voter_register_snapshots
  where process_id = target_process;

  insert into public.voter_register_snapshots (
    organization_id, event_id, process_id, version, status, requested_by,
    assurance_tier, required_approvals, register_revision,
    total_entry_count, eligible_count, rejected_count, revoked_count, integrity_digest
  )
  values (
    target_organization, target_event, target_process, snapshot_version, 'PENDING_APPROVAL',
    caller_id, process_row.assurance_tier, private.required_process_approvals(process_row.assurance_tier),
    process_row.voter_register_revision, total_count, eligible_count, rejected_count,
    revoked_count, snapshot_digest
  )
  returning id into snapshot_id;

  insert into public.voter_register_snapshot_entries(
    snapshot_id, voter_register_entry_id, ordinal, eligibility_status, identity_payload
  )
  select
    snapshot_id,
    v.id,
    row_number() over (order by v.id)::integer,
    v.eligibility_status,
    jsonb_build_object(
      'id', v.id,
      'external_reference', v.external_reference,
      'display_name', v.display_name,
      'contact_email', v.contact_email,
      'contact_phone', v.contact_phone,
      'eligibility_status', v.eligibility_status,
      'source', v.source,
      'created_at', v.created_at
    )
  from public.voter_register_entries v
  where v.process_id = target_process;

  insert into public.audit_events (
    organization_id, actor_user_id, action, resource_type, resource_id, event_data, occurred_at
  )
  values (
    target_organization, caller_id, 'VOTER_REGISTER_FINALIZATION_REQUESTED',
    'voting_process', target_process::text,
    jsonb_build_object(
      'snapshot_id', snapshot_id,
      'version', snapshot_version,
      'register_revision', process_row.voter_register_revision,
      'total_entry_count', total_count,
      'eligible_count', eligible_count,
      'rejected_count', rejected_count,
      'revoked_count', revoked_count,
      'required_approvals', private.required_process_approvals(process_row.assurance_tier),
      'integrity_digest', snapshot_digest,
      'reason', trim(target_reason)
    ),
    now()
  );

  return snapshot_id;
end;
$function$;

create or replace function public.decide_voter_register_finalization(
  target_snapshot uuid,
  target_decision text,
  target_comment text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := private.current_app_user_id();
  snapshot_process_id uuid;
  snapshot_row public.voter_register_snapshots%rowtype;
  process_row public.voting_processes%rowtype;
  approval_count integer;
begin
  if caller_id is null then
    raise exception 'Authenticated application identity is required' using errcode = '28000';
  end if;
  if target_decision not in ('APPROVE','REJECT') then
    raise exception 'Decision must be APPROVE or REJECT' using errcode = '22023';
  end if;
  if target_comment is not null and length(trim(target_comment)) > 1000 then
    raise exception 'Comment cannot exceed 1000 characters' using errcode = '22023';
  end if;

  select s.process_id into snapshot_process_id
  from public.voter_register_snapshots s
  where s.id = target_snapshot;
  if not found then
    raise exception 'Register snapshot not found' using errcode = 'P0002';
  end if;

  -- Lock order is always process first, snapshot second to avoid deadlocks with edits.
  select p.* into process_row
  from public.voting_processes p
  where p.id = snapshot_process_id
  for update;
  if not found then
    raise exception 'Voting process not found' using errcode = 'P0002';
  end if;

  select s.* into snapshot_row
  from public.voter_register_snapshots s
  where s.id = target_snapshot
  for update;
  if not found or snapshot_row.process_id <> snapshot_process_id then
    raise exception 'Register snapshot not found' using errcode = 'P0002';
  end if;
  if snapshot_row.status <> 'PENDING_APPROVAL' then
    raise exception 'Register snapshot is no longer awaiting approval' using errcode = '22023';
  end if;
  if caller_id = snapshot_row.requested_by then
    raise exception 'The requester cannot approve their own register finalization' using errcode = '42501';
  end if;
  if not private.has_org_role(
    snapshot_row.organization_id,
    array['OWNER','ADMIN']::public.organization_member_role[]
  ) then
    raise exception 'Only active organization OWNERs and ADMINs can approve register finalization'
      using errcode = '42501';
  end if;
  if process_row.status <> 'DRAFT' then
    raise exception 'Register finalization is only allowed while the process remains a draft'
      using errcode = '22023';
  end if;

  if process_row.voter_register_revision <> snapshot_row.register_revision then
    update public.voter_register_snapshots
    set status = 'STALE', resolved_at = now()
    where id = target_snapshot;

    insert into public.audit_events (
      organization_id, actor_user_id, action, resource_type, resource_id, event_data, occurred_at
    )
    values (
      snapshot_row.organization_id, caller_id, 'VOTER_REGISTER_FINALIZATION_STALE',
      'voting_process', snapshot_row.process_id::text,
      jsonb_build_object('snapshot_id', target_snapshot, 'reason', 'register_revision_changed'),
      now()
    );
    return target_snapshot;
  end if;

  insert into public.voter_register_snapshot_approvals (
    snapshot_id, approver_user_id, decision, comment
  )
  values (
    target_snapshot, caller_id, target_decision, nullif(trim(target_comment), '')
  );

  insert into public.audit_events (
    organization_id, actor_user_id, action, resource_type, resource_id, event_data, occurred_at
  )
  values (
    snapshot_row.organization_id, caller_id, 'VOTER_REGISTER_FINALIZATION_DECIDED',
    'voting_process', snapshot_row.process_id::text,
    jsonb_build_object(
      'snapshot_id', target_snapshot,
      'decision', target_decision,
      'assurance_tier', snapshot_row.assurance_tier
    ),
    now()
  );

  if target_decision = 'REJECT' then
    update public.voter_register_snapshots
    set status = 'REJECTED', resolved_at = now()
    where id = target_snapshot;
    return target_snapshot;
  end if;

  select count(*)::integer into approval_count
  from public.voter_register_snapshot_approvals
  where snapshot_id = target_snapshot and decision = 'APPROVE';

  if approval_count >= snapshot_row.required_approvals then
    update public.voter_register_snapshots
    set status = 'FINALIZED', finalized_at = now(), resolved_at = now()
    where id = target_snapshot;

    insert into public.audit_events (
      organization_id, actor_user_id, action, resource_type, resource_id, event_data, occurred_at
    )
    values (
      snapshot_row.organization_id, caller_id, 'VOTER_REGISTER_FINALIZED',
      'voting_process', snapshot_row.process_id::text,
      jsonb_build_object(
        'snapshot_id', target_snapshot,
        'version', snapshot_row.version,
        'eligible_count', snapshot_row.eligible_count,
        'integrity_digest', snapshot_row.integrity_digest,
        'required_approvals', snapshot_row.required_approvals,
        'approval_count', approval_count
      ),
      now()
    );
  end if;

  return target_snapshot;
end;
$function$;

create or replace function public.reopen_voter_register_snapshot(
  target_snapshot uuid,
  target_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := private.current_app_user_id();
  snapshot_process_id uuid;
  snapshot_row public.voter_register_snapshots%rowtype;
  process_row public.voting_processes%rowtype;
begin
  if caller_id is null then
    raise exception 'Authenticated application identity is required' using errcode = '28000';
  end if;
  if target_reason is null or length(trim(target_reason)) < 10 or length(trim(target_reason)) > 1000 then
    raise exception 'A reopening reason between 10 and 1000 characters is required' using errcode = '22023';
  end if;

  select s.process_id into snapshot_process_id
  from public.voter_register_snapshots s
  where s.id = target_snapshot;
  if not found then
    raise exception 'Register snapshot not found' using errcode = 'P0002';
  end if;

  -- Match the lock order used by register edits and approval decisions.
  select p.* into process_row
  from public.voting_processes p
  where p.id = snapshot_process_id
  for update;
  if not found then
    raise exception 'Voting process not found' using errcode = 'P0002';
  end if;

  select s.* into snapshot_row
  from public.voter_register_snapshots s
  where s.id = target_snapshot
  for update;
  if not found or snapshot_row.process_id <> snapshot_process_id then
    raise exception 'Register snapshot not found' using errcode = 'P0002';
  end if;
  if snapshot_row.status <> 'FINALIZED' then
    raise exception 'Only a finalized register snapshot can be reopened' using errcode = '22023';
  end if;
  if not private.has_org_role(
    snapshot_row.organization_id,
    array['OWNER','ADMIN']::public.organization_member_role[]
  ) then
    raise exception 'Only organization OWNERs and ADMINs can reopen a finalized register'
      using errcode = '42501';
  end if;
  if process_row.status <> 'DRAFT' then
    raise exception 'A register can only be reopened while its process remains a draft'
      using errcode = '22023';
  end if;

  update public.voter_register_snapshots
  set status = 'REOPENED',
      reopened_at = now(),
      reopened_by = caller_id,
      reopen_reason = trim(target_reason),
      resolved_at = now()
  where id = target_snapshot;

  insert into public.audit_events (
    organization_id, actor_user_id, action, resource_type, resource_id, event_data, occurred_at
  )
  values (
    snapshot_row.organization_id, caller_id, 'VOTER_REGISTER_REOPENED',
    'voting_process', snapshot_row.process_id::text,
    jsonb_build_object(
      'snapshot_id', target_snapshot,
      'version', snapshot_row.version,
      'reason', trim(target_reason)
    ),
    now()
  );

  return target_snapshot;
end;
$function$;

create or replace function private.require_finalized_voter_register_before_submission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if old.status = 'DRAFT'
     and new.status = 'PENDING_APPROVAL'
     and new.eligibility_mode in ('MANAGED_REGISTER','COMBINED')
     and not exists (
       select 1
       from public.voter_register_snapshots s
       where s.process_id = new.id
         and s.status = 'FINALIZED'
         and s.register_revision = new.voter_register_revision
     ) then
    raise exception 'A current, approved voter register snapshot is required before process submission'
      using errcode = '22023';
  end if;
  return new;
end;
$function$;

create trigger voting_process_requires_finalized_register
before update of status on public.voting_processes
for each row execute function private.require_finalized_voter_register_before_submission();

revoke all on function private.guard_finalized_voter_register_mutation() from public, anon, authenticated;
revoke all on function private.track_voter_register_revision() from public, anon, authenticated;
revoke all on function private.require_finalized_voter_register_before_submission() from public, anon, authenticated;

revoke all on function public.request_voter_register_finalization(uuid, text) from public, anon;
revoke all on function public.decide_voter_register_finalization(uuid, text, text) from public, anon;
revoke all on function public.reopen_voter_register_snapshot(uuid, text) from public, anon;
grant execute on function public.request_voter_register_finalization(uuid, text) to authenticated;
grant execute on function public.decide_voter_register_finalization(uuid, text, text) to authenticated;
grant execute on function public.reopen_voter_register_snapshot(uuid, text) to authenticated;
