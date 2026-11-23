create or replace function private.create_organization_invitation(
  target_org uuid,
  target_email text,
  target_role public.organization_member_role
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := private.current_app_user_id();
  caller_role public.organization_member_role;
  normalized_email text := lower(trim(target_email));
  raw_token text := encode(extensions.gen_random_bytes(32), 'hex');
  invitation_id uuid;
  invitation_expiry timestamptz := now() + interval '7 days';
begin
  if caller_id is null then
    raise exception 'Authenticated application identity is required' using errcode = '28000';
  end if;

  if target_org is null
     or normalized_email is null
     or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or length(normalized_email) > 254
     or target_role is null
     or target_role not in ('ADMIN', 'BILLING_MANAGER', 'MEMBER') then
    raise exception 'Provide a valid email and an assignable organization role' using errcode = '22023';
  end if;

  select m.role into caller_role
  from public.organization_memberships m
  where m.organization_id = target_org
    and m.user_id = caller_id
    and m.status = 'ACTIVE'
  for update;

  if caller_role is null then
    raise exception 'Active organization membership is required' using errcode = '42501';
  end if;
  if caller_role not in ('OWNER', 'ADMIN') then
    raise exception 'Only organization OWNERs and ADMINs can invite members' using errcode = '42501';
  end if;
  if target_role = 'ADMIN' and caller_role <> 'OWNER' then
    raise exception 'Only an organization OWNER can invite an ADMIN' using errcode = '42501';
  end if;

  if exists (
    select 1
    from public.app_users u
    join public.organization_memberships m on m.user_id = u.id
    where m.organization_id = target_org
      and lower(u.email) = normalized_email
      and (
        m.status in ('ACTIVE', 'SUSPENDED', 'INVITED')
        or m.role in ('OWNER', 'ADMIN')
      )
  ) then
    raise exception 'This email already belongs to an existing privileged or non-removed organization membership'
      using errcode = '23505';
  end if;

  update public.organization_invitations
  set status = 'EXPIRED'
  where organization_id = target_org
    and lower(email) = normalized_email
    and status = 'PENDING'
    and expires_at <= now();

  if exists (
    select 1 from public.organization_invitations i
    where i.organization_id = target_org
      and lower(i.email) = normalized_email
      and i.status = 'PENDING'
      and i.expires_at > now()
  ) then
    raise exception 'A pending invitation already exists for this email'
      using errcode = '23505';
  end if;

  insert into public.organization_invitations (
    organization_id, email, role, token_hash, invited_by, expires_at
  )
  values (
    target_org,
    normalized_email,
    target_role,
    encode(extensions.digest(convert_to(raw_token, 'UTF8'), 'sha256'), 'hex'),
    caller_id,
    invitation_expiry
  )
  returning id into invitation_id;

  insert into public.audit_events (
    organization_id, actor_user_id, action, resource_type, resource_id, event_data
  )
  values (
    target_org, caller_id, 'ORGANIZATION_INVITATION_CREATED',
    'organization_invitation', invitation_id::text,
    jsonb_build_object('email', normalized_email, 'role', target_role, 'expires_at', invitation_expiry)
  );

  return jsonb_build_object(
    'invitationId', invitation_id,
    'token', raw_token,
    'email', normalized_email,
    'role', target_role,
    'expiresAt', invitation_expiry
  );
end;
$function$;
