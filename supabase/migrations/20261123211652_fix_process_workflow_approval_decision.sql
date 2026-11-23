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
  from public.process_workflow_approvals approvals
  where approvals.request_id = target_request
    and approvals.decision = 'APPROVE';

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