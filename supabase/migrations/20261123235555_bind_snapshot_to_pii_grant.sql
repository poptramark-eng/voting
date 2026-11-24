-- Bind a pending register snapshot to the exact PII grant used to create it.
-- Approval must not proceed after that grant expires, is revoked/suspended, or loses scope.

create table private.voter_register_snapshot_pii_grants (
  snapshot_id uuid primary key
    references public.voter_register_snapshots(id) on delete restrict,
  pii_grant_id uuid not null
    references public.voter_pii_access_requests(id) on delete restrict,
  recipient_user_id uuid not null
    references public.app_users(id) on delete restrict,
  permitted_categories text[] not null,
  required_categories text[] not null,
  created_at timestamptz not null default now()
);

create index voter_register_snapshot_pii_grants_grant_idx
  on private.voter_register_snapshot_pii_grants(pii_grant_id);

revoke all on private.voter_register_snapshot_pii_grants from public, anon, authenticated;

create or replace function private.request_voter_register_finalization_impl(
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
  required_pii_categories text[] := array[]::text[];
  active_grant_categories text[];
  pii_grant_id uuid;
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

  -- Non-governor managers must hold an active, purpose-specific grant covering
  -- every non-null PII category copied into this immutable snapshot.
  if not private.has_org_role(
    target_organization,
    array['OWNER','ADMIN']::public.organization_member_role[]
  ) then
    if exists (
      select 1 from public.voter_register_entries
      where process_id = target_process and display_name is not null
    ) then
      required_pii_categories := array_append(required_pii_categories, 'VOTER_NAME');
    end if;
    if exists (
      select 1 from public.voter_register_entries
      where process_id = target_process and contact_email is not null
    ) then
      required_pii_categories := array_append(required_pii_categories, 'CONTACT_EMAIL');
    end if;
    if exists (
      select 1 from public.voter_register_entries
      where process_id = target_process and contact_phone is not null
    ) then
      required_pii_categories := array_append(required_pii_categories, 'CONTACT_PHONE');
    end if;
    if exists (
      select 1 from public.voter_register_entries
      where process_id = target_process and external_reference is not null
    ) then
      required_pii_categories := array_append(required_pii_categories, 'EXTERNAL_REFERENCE');
    end if;

    if cardinality(required_pii_categories) > 0 then
      select g.grant_id, g.permitted_categories
      into pii_grant_id, active_grant_categories
      from private.active_voter_pii_grant(target_process) g;

      if pii_grant_id is null
         or not (required_pii_categories <@ active_grant_categories) then
        raise exception 'An active voter PII grant covering every populated identity category is required'
          using errcode = '42501';
      end if;
    end if;
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

  if pii_grant_id is not null then
    insert into private.voter_register_snapshot_pii_grants (
      snapshot_id, pii_grant_id, recipient_user_id, permitted_categories, required_categories
    )
    values (
      snapshot_id, pii_grant_id, caller_id, active_grant_categories, required_pii_categories
    );
  end if;

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
      'pii_grant_id', pii_grant_id,
      'pii_categories', required_pii_categories,
      'reason', trim(target_reason)
    ),
    now()
  );

  return snapshot_id;
end;
$function$;

create or replace function private.decide_voter_register_finalization_impl(
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

  if exists (
    select 1 from private.voter_register_snapshot_pii_grants g
    where g.snapshot_id = target_snapshot
  ) and not exists (
    select 1
    from private.voter_register_snapshot_pii_grants g
    join public.voter_pii_access_requests r on r.id = g.pii_grant_id
    where g.snapshot_id = target_snapshot
      and r.recipient_user_id = g.recipient_user_id
      and r.status = 'ACTIVE'
      and r.expires_at > now()
      and g.required_categories <@ r.permitted_categories
      and private.user_has_process_permission(
        snapshot_row.process_id, g.recipient_user_id, 'voter_pii.read'
      )
  ) then
    update public.voter_register_snapshots
    set status = 'STALE', resolved_at = now()
    where id = target_snapshot;

    insert into public.audit_events (
      organization_id, actor_user_id, action, resource_type, resource_id, event_data, occurred_at
    )
    values (
      snapshot_row.organization_id, caller_id, 'VOTER_REGISTER_FINALIZATION_STALE',
      'voting_process', snapshot_row.process_id::text,
      jsonb_build_object(
        'snapshot_id', target_snapshot,
        'reason', 'pii_grant_inactive_or_scope_expired'
      ),
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
