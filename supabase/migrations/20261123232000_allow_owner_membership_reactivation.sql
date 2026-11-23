create or replace function private.update_organization_membership(
  target_org uuid,
  target_user uuid,
  target_role public.organization_member_role,
  target_status public.organization_member_status
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := private.current_app_user_id();
  caller_role public.organization_member_role;
  existing public.organization_memberships%rowtype;
  active_owner_count integer;
begin
  if caller_id is null then
    raise exception 'Authenticated application identity is required' using errcode = '28000';
  end if;
  if target_org is null or target_user is null
     or target_role is null or target_role not in ('OWNER', 'ADMIN', 'BILLING_MANAGER', 'MEMBER')
     or target_status is null or target_status not in ('ACTIVE', 'SUSPENDED', 'REMOVED') then
    raise exception 'Invalid membership role or status' using errcode = '22023';
  end if;

  perform 1 from public.organizations o where o.id = target_org for update;
  if not found then
    raise exception 'Organization not found' using errcode = 'P0002';
  end if;

  select m.role into caller_role
  from public.organization_memberships m
  where m.organization_id = target_org
    and m.user_id = caller_id
    and m.status = 'ACTIVE';

  if caller_role not in ('OWNER', 'ADMIN') or caller_role is null then
    raise exception 'Only active organization OWNERs and ADMINs can manage memberships' using errcode = '42501';
  end if;

  select * into existing
  from public.organization_memberships m
  where m.organization_id = target_org and m.user_id = target_user
  for update;

  if not found then
    raise exception 'Organization membership not found' using errcode = 'P0002';
  end if;

  if existing.role = 'OWNER' then
    if caller_role <> 'OWNER' then
      raise exception 'Only an OWNER can manage another OWNER membership' using errcode = '42501';
    end if;
    if target_role <> 'OWNER' then
      raise exception 'Ownership role changes require the dedicated ownership governance flow' using errcode = '22023';
    end if;
    if target_status <> 'ACTIVE' then
      select count(*) into active_owner_count
      from public.organization_memberships m
      where m.organization_id = target_org
        and m.role = 'OWNER'
        and m.status = 'ACTIVE';
      if active_owner_count <= 1 then
        raise exception 'The organization must retain at least one active OWNER' using errcode = '23514';
      end if;
    end if;
  elsif target_role = 'OWNER' then
    raise exception 'Ownership role changes require the dedicated ownership governance flow'
      using errcode = '22023';
  elsif existing.role = 'ADMIN' and caller_role <> 'OWNER' then
    raise exception 'Only an OWNER can manage an ADMIN membership' using errcode = '42501';
  end if;

  if target_role = 'ADMIN' and caller_role <> 'OWNER' then
    raise exception 'Only an OWNER can appoint an ADMIN' using errcode = '42501';
  end if;

  update public.organization_memberships
  set role = target_role, status = target_status, updated_at = now()
  where id = existing.id;

  if target_status <> 'ACTIVE' then
    update public.event_role_assignments
    set status = 'REVOKED', updated_at = now()
    where organization_id = target_org
      and user_id = target_user
      and status = 'ACTIVE';

    update public.process_role_assignments
    set status = 'REVOKED', updated_at = now()
    where organization_id = target_org
      and user_id = target_user
      and status = 'ACTIVE';
  end if;

  insert into public.audit_events (
    organization_id, actor_user_id, action, resource_type, resource_id, event_data
  )
  values (
    target_org, caller_id, 'ORGANIZATION_MEMBERSHIP_UPDATED',
    'organization_membership', existing.id::text,
    jsonb_build_object(
      'user_id', target_user,
      'previous_role', existing.role,
      'new_role', target_role,
      'previous_status', existing.status,
      'new_status', target_status
    )
  );

  return jsonb_build_object(
    'membershipId', existing.id,
    'userId', target_user,
    'role', target_role,
    'status', target_status
  );
end;
$function$;
