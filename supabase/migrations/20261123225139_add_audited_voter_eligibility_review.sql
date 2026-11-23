-- Eligibility review is a controlled write operation. Keep voter PII reads
-- on the audited RPC and route status changes through a validated private function.

revoke insert, update, delete on public.voter_register_entries from public, anon;
revoke update, delete on public.voter_register_entries from authenticated;
grant insert on public.voter_register_entries to authenticated;

drop policy if exists "authorized managers can update draft voter register entries"
  on public.voter_register_entries;

create or replace function private.update_voter_register_eligibility(
  target_process uuid,
  target_entry uuid,
  target_status text,
  target_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := private.current_app_user_id();
  organization_id uuid;
  process_status text;
  current_status text;
  pii_grant_id uuid;
begin
  if caller_id is null then
    raise exception 'Authenticated application identity is required' using errcode = '28000';
  end if;

  if target_process is null
     or target_entry is null
     or target_status is null
     or target_status not in ('ELIGIBLE', 'REJECTED', 'REVOKED')
     or target_reason is null
     or length(trim(target_reason)) < 10
     or length(trim(target_reason)) > 1000 then
    raise exception 'Invalid eligibility decision or review reason' using errcode = '22023';
  end if;

  select e.organization_id, p.status::text, v.eligibility_status
  into organization_id, process_status, current_status
  from public.voter_register_entries v
  join public.voting_processes p on p.id = v.process_id
  join public.voting_events e on e.id = p.event_id
  where v.id = target_entry
    and v.process_id = target_process
  for update of v, p;

  if not found then
    raise exception 'Voter register entry not found in this process' using errcode = 'P0002';
  end if;

  if process_status <> 'DRAFT'
     or not private.can_manage_draft_voter_register(target_process) then
    raise exception 'Only authorized managers can review a draft voter register' using errcode = '42501';
  end if;

  if not private.has_org_role(
    organization_id,
    array['OWNER', 'ADMIN']::public.organization_member_role[]
  ) then
    select g.grant_id
    into pii_grant_id
    from private.active_voter_pii_grant(target_process) g
    where 'VOTER_NAME' = any(g.permitted_categories)
    limit 1;

    if pii_grant_id is null then
      raise exception 'An active voter PII grant including voter names is required for eligibility review'
        using errcode = '42501';
    end if;
  end if;

  if current_status = 'PENDING' and target_status not in ('ELIGIBLE', 'REJECTED') then
    raise exception 'Pending entries may only be marked ELIGIBLE or REJECTED' using errcode = '22023';
  elsif current_status = 'ELIGIBLE' and target_status <> 'REVOKED' then
    raise exception 'Eligible entries may only be REVOKED' using errcode = '22023';
  else
    raise exception 'This voter eligibility status is terminal or the requested transition is invalid'
      using errcode = '22023';
  end if;

  update public.voter_register_entries
  set eligibility_status = target_status
  where id = target_entry
    and process_id = target_process;

  insert into public.audit_events (
    organization_id,
    actor_user_id,
    action,
    resource_type,
    resource_id,
    event_data,
    occurred_at
  )
  values (
    organization_id,
    caller_id,
    'VOTER_ELIGIBILITY_REVIEWED',
    'voting_process',
    target_process::text,
    jsonb_build_object(
      'entry_id', target_entry,
      'from_status', current_status,
      'to_status', target_status,
      'reason', trim(target_reason),
      'pii_grant_id', pii_grant_id
    ),
    now()
  );

  return jsonb_build_object(
    'entryId', target_entry,
    'eligibilityStatus', target_status
  );
end;
$function$;

revoke all on function private.update_voter_register_eligibility(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function private.update_voter_register_eligibility(uuid, uuid, text, text)
  to authenticated;

create or replace function public.update_voter_register_eligibility(
  target_process uuid,
  target_entry uuid,
  target_status text,
  target_reason text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $function$
  select private.update_voter_register_eligibility(
    target_process,
    target_entry,
    target_status,
    target_reason
  );
$function$;

revoke all on function public.update_voter_register_eligibility(uuid, uuid, text, text)
  from public, anon;
grant execute on function public.update_voter_register_eligibility(uuid, uuid, text, text)
  to authenticated;
