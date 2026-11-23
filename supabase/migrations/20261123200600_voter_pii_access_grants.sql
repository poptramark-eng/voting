-- Purpose-bound, assurance-tiered access to voter-identifying register fields.
-- Apply only after the repository migration history is reconciled and this migration
-- has been reviewed and exercised in a staging Supabase project.

insert into private.scoped_role_permissions (role, permission) values
  ('ELECTION_MANAGER', 'voter_pii.read'),
  ('AUDITOR', 'voter_pii.read')
on conflict (role, permission) do nothing;

create table public.voter_pii_access_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  event_id uuid not null references public.voting_events(id) on delete restrict,
  process_id uuid references public.voting_processes(id) on delete restrict,
  scope_type text not null check (scope_type in ('EVENT', 'PROCESS')),
  recipient_user_id uuid not null references public.app_users(id) on delete restrict,
  requested_by uuid not null references public.app_users(id) on delete restrict,
  permitted_categories text[] not null
    check (
      cardinality(permitted_categories) between 1 and 4
      and permitted_categories <@ array[
        'VOTER_NAME',
        'CONTACT_EMAIL',
        'CONTACT_PHONE',
        'EXTERNAL_REFERENCE'
      ]::text[]
    ),
  purpose text not null check (length(trim(purpose)) between 20 and 1000),
  assurance_tier public.assurance_tier not null,
  required_approvals smallint not null check (required_approvals between 1 and 3),
  requested_expires_at timestamptz not null,
  status text not null default 'PENDING'
    check (status in ('PENDING', 'ACTIVE', 'REJECTED', 'REVOKED', 'STALE')),
  granted_at timestamptz,
  expires_at timestamptz,
  resolved_at timestamptz,
  revoked_by uuid references public.app_users(id) on delete restrict,
  revoked_at timestamptz,
  revocation_reason text check (revocation_reason is null or length(revocation_reason) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint voter_pii_scope_shape check (
    (scope_type = 'EVENT' and process_id is null)
    or (scope_type = 'PROCESS' and process_id is not null)
  ),
  constraint voter_pii_active_expiry check (
    status <> 'ACTIVE' or (granted_at is not null and expires_at is not null)
  )
);

create index voter_pii_requests_org_created_idx
  on public.voter_pii_access_requests(organization_id, created_at desc);
create index voter_pii_requests_recipient_status_idx
  on public.voter_pii_access_requests(recipient_user_id, status, expires_at);
create index voter_pii_requests_event_scope_idx
  on public.voter_pii_access_requests(event_id, scope_type, status);

create table public.voter_pii_access_approvals (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.voter_pii_access_requests(id) on delete restrict,
  approver_user_id uuid not null references public.app_users(id) on delete restrict,
  decision text not null check (decision in ('APPROVE', 'REJECT')),
  comment text check (comment is null or length(comment) <= 2000),
  request_snapshot jsonb not null,
  decided_at timestamptz not null default now(),
  constraint voter_pii_approvals_one_decision_per_person
    unique (request_id, approver_user_id)
);

create index voter_pii_approvals_request_idx
  on public.voter_pii_access_approvals(request_id, decided_at);

alter table public.voter_pii_access_requests enable row level security;
alter table public.voter_pii_access_approvals enable row level security;

revoke all on public.voter_pii_access_requests,
  public.voter_pii_access_approvals
from public, anon, authenticated;

grant select on public.voter_pii_access_requests,
  public.voter_pii_access_approvals
to authenticated;

create policy "authorized parties can read voter PII access requests"
on public.voter_pii_access_requests for select to authenticated
using (
  private.has_org_role(
    organization_id,
    array['OWNER','ADMIN']::public.organization_member_role[]
  )
  or requested_by = (select private.current_app_user_id())
  or recipient_user_id = (select private.current_app_user_id())
);

create policy "authorized parties can read voter PII access approvals"
on public.voter_pii_access_approvals for select to authenticated
using (
  approver_user_id = (select private.current_app_user_id())
  or exists (
    select 1
    from public.voter_pii_access_requests r
    where r.id = request_id
      and (
        private.has_org_role(
          r.organization_id,
          array['OWNER','ADMIN']::public.organization_member_role[]
        )
        or r.requested_by = (select private.current_app_user_id())
        or r.recipient_user_id = (select private.current_app_user_id())
      )
  )
);

create trigger voter_pii_access_requests_set_updated_at
before update on public.voter_pii_access_requests
for each row execute function private.set_row_updated_at();

create or replace function private.user_has_event_pii_role(
  target_event uuid,
  target_user uuid
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
    join public.organization_memberships m
      on m.organization_id = a.organization_id
     and m.user_id = a.user_id
    where a.event_id = target_event
      and a.user_id = target_user
      and a.role in ('ELECTION_MANAGER', 'AUDITOR')
      and a.status = 'ACTIVE'
      and (a.expires_at is null or a.expires_at > now())
      and m.status = 'ACTIVE'
  );
$function$;

create or replace function private.user_has_process_permission(
  target_process uuid,
  target_user uuid,
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
     and m.user_id = target_user
    join public.event_role_assignments ea
      on ea.event_id = e.id
     and ea.user_id = target_user
    left join public.process_role_assignments pa
      on pa.process_id = p.id
     and pa.user_id = target_user
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

create or replace function private.resolve_voter_pii_assurance(
  target_event uuid,
  target_process uuid default null
)
returns public.assurance_tier
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  resolved_tier public.assurance_tier;
begin
  if target_process is not null then
    select p.assurance_tier into resolved_tier
    from public.voting_processes p
    where p.id = target_process and p.event_id = target_event;
    if resolved_tier is null then
      raise exception 'Voting process does not belong to the requested event' using errcode = '22023';
    end if;
    return resolved_tier;
  end if;

  select coalesce(
    (
      select p.assurance_tier
      from public.voting_processes p
      where p.event_id = target_event
      order by private.assurance_tier_rank(p.assurance_tier) desc
      limit 1
    ),
    e.assurance_tier
  )
  into resolved_tier
  from public.voting_events e
  where e.id = target_event;

  if resolved_tier is null then
    raise exception 'Voting event not found' using errcode = 'P0002';
  end if;

  return resolved_tier;
end;
$function$;

create or replace function private.required_voter_pii_approvals(
  target_tier public.assurance_tier
)
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

create or replace function private.max_voter_pii_grant_lifetime(
  target_tier public.assurance_tier
)
returns interval
language sql
immutable
set search_path = ''
as $function$
  select case target_tier
    when 'STANDARD' then interval '30 days'
    when 'ENHANCED' then interval '7 days'
    when 'HIGH' then interval '24 hours'
    when 'CRITICAL' then interval '4 hours'
  end;
$function$;

create or replace function private.active_voter_pii_grant(target_process uuid)
returns table (
  grant_id uuid,
  permitted_categories text[],
  purpose text,
  assurance_tier public.assurance_tier
)
language sql
stable
security definer
set search_path = ''
as $function$
  select r.id, r.permitted_categories, r.purpose, r.assurance_tier
  from public.voter_pii_access_requests r
  join public.voting_processes p on p.id = target_process
  join public.voting_events e on e.id = p.event_id
  where r.organization_id = e.organization_id
    and r.recipient_user_id = (select private.current_app_user_id())
    and r.status = 'ACTIVE'
    and r.expires_at > now()
    and (
      (r.scope_type = 'EVENT' and r.event_id = e.id and r.process_id is null)
      or (r.scope_type = 'PROCESS' and r.event_id = e.id and r.process_id = p.id)
    )
    and private.assurance_tier_rank(r.assurance_tier)
        >= private.assurance_tier_rank(
          case when r.scope_type = 'EVENT'
            then private.resolve_voter_pii_assurance(e.id, null)
            else p.assurance_tier
          end
        )
    and private.has_process_permission(target_process, 'voter_pii.read')
  order by case when r.scope_type = 'PROCESS' then 0 else 1 end,
           r.granted_at desc
  limit 1;
$function$;

create or replace function private.has_active_voter_pii_grant(target_process uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1 from private.active_voter_pii_grant(target_process)
  );
$function$;

revoke all on function private.user_has_event_pii_role(uuid, uuid) from public, anon, authenticated;
revoke all on function private.user_has_process_permission(uuid, uuid, text) from public, anon, authenticated;
revoke all on function private.resolve_voter_pii_assurance(uuid, uuid) from public, anon, authenticated;
revoke all on function private.required_voter_pii_approvals(public.assurance_tier) from public, anon, authenticated;
revoke all on function private.max_voter_pii_grant_lifetime(public.assurance_tier) from public, anon, authenticated;
revoke all on function private.active_voter_pii_grant(uuid) from public, anon, authenticated;
revoke all on function private.has_active_voter_pii_grant(uuid) from public, anon, authenticated;
grant execute on function private.has_active_voter_pii_grant(uuid) to authenticated;

create or replace function public.request_voter_pii_access(
  target_scope text,
  target_event uuid,
  target_process uuid,
  target_recipient uuid,
  target_categories text[],
  target_purpose text,
  target_expires_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := private.current_app_user_id();
  target_org uuid;
  resolved_tier public.assurance_tier;
  request_id uuid;
begin
  if caller_id is null then
    raise exception 'Authenticated application identity is required' using errcode = '28000';
  end if;
  if target_scope is null
     or target_scope not in ('EVENT', 'PROCESS')
     or target_event is null
     or target_recipient is null
     or target_categories is null
     or cardinality(target_categories) < 1
     or cardinality(target_categories) > 4
     or array_position(target_categories, null) is not null
     or not (target_categories <@ array[
       'VOTER_NAME', 'CONTACT_EMAIL', 'CONTACT_PHONE', 'EXTERNAL_REFERENCE'
     ]::text[])
     or cardinality(target_categories) <> (
       select count(distinct category)::integer from unnest(target_categories) as category
     )
     or target_purpose is null
     or length(trim(target_purpose)) < 20
     or length(trim(target_purpose)) > 1000
     or target_expires_at is null
     or target_expires_at <= now() then
    raise exception 'Invalid voter PII access request details' using errcode = '22023';
  end if;

  if (target_scope = 'EVENT' and target_process is not null)
     or (target_scope = 'PROCESS' and target_process is null) then
    raise exception 'Event scope has no process ID; process scope requires a process ID' using errcode = '22023';
  end if;

  select e.organization_id into target_org
  from public.voting_events e
  where e.id = target_event
  for update;

  if target_org is null then
    raise exception 'Voting event not found' using errcode = 'P0002';
  end if;

  if target_scope = 'PROCESS' and not exists (
    select 1 from public.voting_processes p
    where p.id = target_process and p.event_id = target_event
    for update
  ) then
    raise exception 'Voting process does not belong to the requested event' using errcode = '22023';
  end if;

  if target_recipient = caller_id then
    -- A scoped recipient may request access for themselves.
    null;
  elsif not private.has_org_role(
    target_org,
    array['OWNER','ADMIN']::public.organization_member_role[]
  ) then
    raise exception 'Only an active organization OWNER or ADMIN can request access for another person' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.organization_memberships m
    where m.organization_id = target_org
      and m.user_id = target_recipient
      and m.status = 'ACTIVE'
  ) then
    raise exception 'The recipient must be an active organization member' using errcode = '22023';
  end if;

  if target_scope = 'EVENT' then
    if not private.user_has_event_pii_role(target_event, target_recipient) then
      raise exception 'The recipient must have an active ELECTION_MANAGER or AUDITOR assignment for this event' using errcode = '42501';
    end if;
  elsif not private.user_has_process_permission(target_process, target_recipient, 'voter_pii.read') then
    raise exception 'The recipient must have an active ELECTION_MANAGER or AUDITOR assignment covering this process' using errcode = '42501';
  end if;

  resolved_tier := private.resolve_voter_pii_assurance(target_event, target_process);
  if target_expires_at > now() + private.max_voter_pii_grant_lifetime(resolved_tier) then
    raise exception 'Requested expiry exceeds the maximum lifetime for this assurance tier' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.voter_pii_access_requests r
    where r.organization_id = target_org
      and r.event_id = target_event
      and r.recipient_user_id = target_recipient
      and (
        (r.status = 'PENDING' and r.requested_expires_at > now())
        or (r.status = 'ACTIVE' and r.expires_at > now())
      )
      and (
        target_scope = 'EVENT'
        or r.scope_type = 'EVENT'
        or (r.scope_type = 'PROCESS' and r.process_id = target_process)
      )
  ) then
    raise exception 'An overlapping pending or active voter PII grant already exists' using errcode = '23505';
  end if;

  insert into public.voter_pii_access_requests (
    organization_id, event_id, process_id, scope_type,
    recipient_user_id, requested_by, permitted_categories,
    purpose, assurance_tier, required_approvals, requested_expires_at
  )
  values (
    target_org, target_event, target_process, target_scope,
    target_recipient, caller_id, target_categories,
    trim(target_purpose), resolved_tier,
    private.required_voter_pii_approvals(resolved_tier),
    target_expires_at
  )
  returning id into request_id;

  insert into public.audit_events (
    organization_id, actor_user_id, action, resource_type, resource_id, event_data
  )
  values (
    target_org, caller_id, 'VOTER_PII_ACCESS_REQUESTED',
    'voter_pii_access_request', request_id::text,
    jsonb_build_object(
      'event_id', target_event,
      'process_id', target_process,
      'scope_type', target_scope,
      'recipient_user_id', target_recipient,
      'categories', target_categories,
      'purpose', trim(target_purpose),
      'assurance_tier', resolved_tier,
      'required_approvals', private.required_voter_pii_approvals(resolved_tier),
      'requested_expires_at', target_expires_at
    )
  );

  return request_id;
end;
$function$;

create or replace function public.decide_voter_pii_access_request(
  target_request uuid,
  target_decision text,
  target_comment text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := private.current_app_user_id();
  request_row public.voter_pii_access_requests%rowtype;
  current_tier public.assurance_tier;
  approval_count integer;
  next_status text;
begin
  if caller_id is null then
    raise exception 'Authenticated application identity is required' using errcode = '28000';
  end if;
  if target_decision is null
     or target_decision not in ('APPROVE', 'REJECT')
     or (target_comment is not null and length(target_comment) > 2000) then
    raise exception 'Invalid approval decision or comment' using errcode = '22023';
  end if;

  select * into request_row
  from public.voter_pii_access_requests
  where id = target_request
  for update;

  if not found then
    raise exception 'Voter PII access request not found' using errcode = 'P0002';
  end if;

  perform 1 from public.voting_events
  where id = request_row.event_id
  for update;

  if request_row.status <> 'PENDING' then
    raise exception 'Only pending voter PII access requests can receive decisions' using errcode = '22023';
  end if;
  if caller_id = request_row.requested_by then
    raise exception 'The requester cannot approve or reject their own request' using errcode = '42501';
  end if;
  if not private.has_org_role(
    request_row.organization_id,
    array['OWNER','ADMIN']::public.organization_member_role[]
  ) then
    raise exception 'An active organization OWNER or ADMIN is required to decide this request' using errcode = '42501';
  end if;

  current_tier := private.resolve_voter_pii_assurance(
    request_row.event_id,
    request_row.process_id
  );

  if current_tier <> request_row.assurance_tier
     or request_row.requested_expires_at <= now()
     or request_row.requested_expires_at >
        now() + private.max_voter_pii_grant_lifetime(current_tier) then
    update public.voter_pii_access_requests
    set status = 'STALE', resolved_at = now()
    where id = request_row.id;

    insert into public.audit_events (
      organization_id, actor_user_id, action, resource_type, resource_id, event_data
    )
    values (
      request_row.organization_id, caller_id, 'VOTER_PII_ACCESS_REQUEST_STALE',
      'voter_pii_access_request', request_row.id::text,
      jsonb_build_object('original_tier', request_row.assurance_tier, 'current_tier', current_tier)
    );

    return jsonb_build_object('requestId', request_row.id, 'status', 'STALE');
  end if;

  if request_row.scope_type = 'EVENT' then
    if not private.user_has_event_pii_role(request_row.event_id, request_row.recipient_user_id) then
      update public.voter_pii_access_requests set status = 'STALE', resolved_at = now()
      where id = request_row.id;
      insert into public.audit_events (
        organization_id, actor_user_id, action, resource_type, resource_id, event_data
      )
      values (
        request_row.organization_id, caller_id, 'VOTER_PII_ACCESS_REQUEST_STALE',
        'voter_pii_access_request', request_row.id::text,
        jsonb_build_object('reason', 'Recipient no longer has an active event-scoped ELECTION_MANAGER or AUDITOR assignment')
      );
      return jsonb_build_object('requestId', request_row.id, 'status', 'STALE');
    end if;
  elsif not private.user_has_process_permission(
    request_row.process_id, request_row.recipient_user_id, 'voter_pii.read'
  ) then
    update public.voter_pii_access_requests set status = 'STALE', resolved_at = now()
    where id = request_row.id;
    insert into public.audit_events (
      organization_id, actor_user_id, action, resource_type, resource_id, event_data
    )
    values (
      request_row.organization_id, caller_id, 'VOTER_PII_ACCESS_REQUEST_STALE',
      'voter_pii_access_request', request_row.id::text,
      jsonb_build_object('reason', 'Recipient no longer has an active process-scoped ELECTION_MANAGER or AUDITOR permission')
    );
    return jsonb_build_object('requestId', request_row.id, 'status', 'STALE');
  end if;

  insert into public.voter_pii_access_approvals (
    request_id, approver_user_id, decision, comment, request_snapshot
  )
  values (
    request_row.id,
    caller_id,
    target_decision,
    nullif(trim(coalesce(target_comment, '')), ''),
    jsonb_build_object(
      'organization_id', request_row.organization_id,
      'event_id', request_row.event_id,
      'process_id', request_row.process_id,
      'scope_type', request_row.scope_type,
      'recipient_user_id', request_row.recipient_user_id,
      'permitted_categories', request_row.permitted_categories,
      'purpose', request_row.purpose,
      'assurance_tier', request_row.assurance_tier,
      'requested_expires_at', request_row.requested_expires_at
    )
  );

  if target_decision = 'REJECT' then
    next_status := 'REJECTED';
    update public.voter_pii_access_requests
    set status = next_status, resolved_at = now()
    where id = request_row.id;
  else
    select count(*) into approval_count
    from public.voter_pii_access_approvals
    where request_id = request_row.id
      and decision = 'APPROVE';

    if approval_count >= request_row.required_approvals then
      next_status := 'ACTIVE';
      update public.voter_pii_access_requests
      set status = next_status,
          granted_at = now(),
          expires_at = request_row.requested_expires_at,
          resolved_at = now()
      where id = request_row.id;
    else
      next_status := 'PENDING';
    end if;
  end if;

  insert into public.audit_events (
    organization_id, actor_user_id, action, resource_type, resource_id, event_data
  )
  values (
    request_row.organization_id,
    caller_id,
    case when target_decision = 'REJECT'
      then 'VOTER_PII_ACCESS_REJECTED'
      when next_status = 'ACTIVE'
      then 'VOTER_PII_ACCESS_GRANTED'
      else 'VOTER_PII_ACCESS_APPROVAL_RECORDED'
    end,
    'voter_pii_access_request',
    request_row.id::text,
    jsonb_build_object(
      'decision', target_decision,
      'comment', nullif(trim(coalesce(target_comment, '')), ''),
      'approval_count', case when target_decision = 'APPROVE' then approval_count else null end,
      'required_approvals', request_row.required_approvals,
      'status', next_status,
      'assurance_tier', request_row.assurance_tier
    )
  );

  return jsonb_build_object(
    'requestId', request_row.id,
    'status', next_status,
    'approvalCount', case when target_decision = 'APPROVE' then approval_count else 0 end,
    'requiredApprovals', request_row.required_approvals,
    'expiresAt', case when next_status = 'ACTIVE' then request_row.requested_expires_at else null end
  );
end;
$function$;

create or replace function public.revoke_voter_pii_access(
  target_request uuid,
  target_reason text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := private.current_app_user_id();
  request_row public.voter_pii_access_requests%rowtype;
begin
  if caller_id is null then
    raise exception 'Authenticated application identity is required' using errcode = '28000';
  end if;
  if target_reason is null or length(trim(target_reason)) < 10 or length(trim(target_reason)) > 1000 then
    raise exception 'A revocation reason between 10 and 1000 characters is required' using errcode = '22023';
  end if;

  select * into request_row
  from public.voter_pii_access_requests
  where id = target_request
  for update;

  if not found then
    raise exception 'Voter PII access request not found' using errcode = 'P0002';
  end if;

  perform 1 from public.voting_events
  where id = request_row.event_id
  for update;

  if not private.has_org_role(
    request_row.organization_id,
    array['OWNER','ADMIN']::public.organization_member_role[]
  ) then
    raise exception 'Only an active organization OWNER or ADMIN can revoke voter PII access' using errcode = '42501';
  end if;
  if request_row.status not in ('PENDING', 'ACTIVE') then
    raise exception 'Only pending or active grants can be revoked' using errcode = '22023';
  end if;

  update public.voter_pii_access_requests
  set status = 'REVOKED',
      revoked_by = caller_id,
      revoked_at = now(),
      revocation_reason = trim(target_reason),
      resolved_at = now()
  where id = request_row.id;

  insert into public.audit_events (
    organization_id, actor_user_id, action, resource_type, resource_id, event_data
  )
  values (
    request_row.organization_id, caller_id, 'VOTER_PII_ACCESS_REVOKED',
    'voter_pii_access_request', request_row.id::text,
    jsonb_build_object(
      'recipient_user_id', request_row.recipient_user_id,
      'event_id', request_row.event_id,
      'process_id', request_row.process_id,
      'scope_type', request_row.scope_type,
      'reason', trim(target_reason)
    )
  );

  return true;
end;
$function$;

create or replace function public.read_voter_register_entries(
  target_process uuid,
  target_access_mode text default 'VIEW',
  target_limit integer default 500,
  target_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := private.current_app_user_id();
  organization_id uuid;
  grant_id uuid;
  categories text[];
  access_purpose text;
  result_rows jsonb;
  result_count integer;
begin
  if caller_id is null then
    raise exception 'Authenticated application identity is required' using errcode = '28000';
  end if;
  if target_access_mode is null
     or target_access_mode not in ('VIEW', 'EXPORT')
     or target_limit is null or target_limit < 1 or target_limit > 5000
     or target_offset is null or target_offset < 0 or target_offset > 1000000 then
    raise exception 'Invalid voter register access mode or pagination' using errcode = '22023';
  end if;

  select e.organization_id into organization_id
  from public.voting_processes p
  join public.voting_events e on e.id = p.event_id
  where p.id = target_process;

  if organization_id is null then
    raise exception 'Voting process not found' using errcode = 'P0002';
  end if;

  if private.has_org_role(
    organization_id,
    array['OWNER','ADMIN']::public.organization_member_role[]
  ) then
    categories := array[
      'VOTER_NAME', 'CONTACT_EMAIL', 'CONTACT_PHONE', 'EXTERNAL_REFERENCE'
    ]::text[];
    access_purpose := 'Organization administration';
  else
    select g.grant_id, g.permitted_categories, g.purpose
    into grant_id, categories, access_purpose
    from private.active_voter_pii_grant(target_process) g;

    if grant_id is null then
      raise exception 'An active purpose-specific voter PII grant is required' using errcode = '42501';
    end if;
  end if;

  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', v.id,
          'eligibilityStatus', v.eligibility_status,
          'source', v.source,
          'createdAt', v.created_at,
          'updatedAt', v.updated_at
        )
        || case when 'VOTER_NAME' = any(categories)
          then jsonb_build_object('displayName', v.display_name) else '{}'::jsonb end
        || case when 'CONTACT_EMAIL' = any(categories)
          then jsonb_build_object('contactEmail', v.contact_email) else '{}'::jsonb end
        || case when 'CONTACT_PHONE' = any(categories)
          then jsonb_build_object('contactPhone', v.contact_phone) else '{}'::jsonb end
        || case when 'EXTERNAL_REFERENCE' = any(categories)
          then jsonb_build_object('externalReference', v.external_reference) else '{}'::jsonb end
        order by v.created_at, v.id
      ),
      '[]'::jsonb
    ),
    count(*)::integer
  into result_rows, result_count
  from (
    select *
    from public.voter_register_entries
    where process_id = target_process
    order by created_at, id
    limit target_limit offset target_offset
  ) v;

  insert into public.audit_events (
    organization_id, actor_user_id, action, resource_type, resource_id, event_data
  )
  values (
    organization_id,
    caller_id,
    case when target_access_mode = 'EXPORT'
      then 'VOTER_PII_EXPORTED' else 'VOTER_PII_ACCESSED' end,
    'voter_register',
    target_process::text,
    jsonb_build_object(
      'grant_id', grant_id,
      'access_mode', target_access_mode,
      'categories', categories,
      'purpose', access_purpose,
      'returned_rows', result_count,
      'offset', target_offset,
      'limit', target_limit
    )
  );

  return result_rows;
end;
$function$;

-- Force all authenticated voter-register reads through the audited, category-
-- filtered RPC. Keep writes protected by the existing OWNER/ADMIN RLS policies.
revoke select on public.voter_register_entries from public, anon, authenticated;

drop policy if exists "organization admins can read voter registers"
  on public.voter_register_entries;
create policy "admins and specifically authorized scoped users can read voter registers"
on public.voter_register_entries for select to authenticated
using (
  exists (
    select 1 from public.voting_processes p
    join public.voting_events e on e.id = p.event_id
    where p.id = process_id
      and (
        private.has_org_role(
          e.organization_id,
          array['OWNER','ADMIN']::public.organization_member_role[]
        )
        or (
          private.has_process_permission(p.id, 'voter_pii.read')
          and private.has_active_voter_pii_grant(p.id)
        )
      )
  )
);

revoke all on function public.request_voter_pii_access(
  text, uuid, uuid, uuid, text[], text, timestamptz
) from public, anon, authenticated;
revoke all on function public.decide_voter_pii_access_request(uuid, text, text)
  from public, anon;
revoke all on function public.revoke_voter_pii_access(uuid, text)
  from public, anon;
revoke all on function public.read_voter_register_entries(uuid, text, integer, integer)
  from public, anon;

grant execute on function public.request_voter_pii_access(
  text, uuid, uuid, uuid, text[], text, timestamptz
) to authenticated;
grant execute on function public.decide_voter_pii_access_request(uuid, text, text)
  to authenticated;
grant execute on function public.revoke_voter_pii_access(uuid, text)
  to authenticated;
grant execute on function public.read_voter_register_entries(uuid, text, integer, integer)
  to authenticated;

comment on table public.voter_pii_access_requests is
  'Immutable purpose/scope/category/expiry request and current state for time-limited voter-identifying data grants. Status changes occur only through audited RPCs.';
comment on table public.voter_pii_access_approvals is
  'Distinct OWNER/ADMIN approval decisions with a snapshot of the exact voter PII grant request.';
comment on function public.read_voter_register_entries(uuid, text, integer, integer) is
  'Audited, paginated voter-register read/export. Authenticated direct SELECT is revoked; returned identifying columns are limited to active grant categories.';
