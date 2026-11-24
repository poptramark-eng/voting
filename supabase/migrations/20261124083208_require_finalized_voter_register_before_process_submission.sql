create or replace function private.submit_process_for_approval_impl(target_process uuid)
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

  select p.*
  into process_row
  from public.voting_processes p
  where p.id = target_process
  for update;

  select e.organization_id
  into organization_id
  from public.voting_processes p
  join public.voting_events e on e.id = p.event_id
  where p.id = target_process;

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

  -- Managed-register processes cannot enter governance approval until the
  -- exact current register revision has an independently approved snapshot.
  if process_row.eligibility_mode in ('MANAGED_REGISTER', 'COMBINED')
     and not exists (
       select 1
       from public.voter_register_snapshots s
       where s.process_id = target_process
         and s.status = 'FINALIZED'
         and s.register_revision = process_row.voter_register_revision
         and s.eligible_count > 0
     ) then
    raise exception 'A finalized voter register matching the current register revision is required before process submission'
      using errcode = '22023';
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
