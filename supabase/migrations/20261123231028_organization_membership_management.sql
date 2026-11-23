-- Organization invitations and membership administration.
-- Invitation tokens are returned once for out-of-band sharing; only their SHA-256
-- hashes are persisted. Acceptance requires a verified Auth0 email claim.

create table public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  email text not null check (length(trim(email)) between 3 and 254),
  role public.organization_member_role not null
    check (role in ('ADMIN', 'BILLING_MANAGER', 'MEMBER')),
  token_hash text not null unique check (length(token_hash) = 64),
  status text not null default 'PENDING'
    check (status in ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED')),
  invited_by uuid not null references public.app_users(id) on delete restrict,
  accepted_by uuid references public.app_users(id) on delete restrict,
  accepted_at timestamptz,
  revoked_by uuid references public.app_users(id) on delete restrict,
  revoked_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint organization_invitation_acceptance_shape check (
    (status <> 'ACCEPTED' and accepted_by is null and accepted_at is null)
    or (status = 'ACCEPTED' and accepted_by is not null and accepted_at is not null)
  ),
  constraint organization_invitation_revocation_shape check (
    (status <> 'REVOKED' and revoked_by is null and revoked_at is null)
    or (status = 'REVOKED' and revoked_by is not null and revoked_at is not null)
  )
);

create unique index organization_invitations_one_pending_email
  on public.organization_invitations (organization_id, lower(email))
  where status = 'PENDING';

create index organization_invitations_org_created_idx
  on public.organization_invitations (organization_id, created_at desc);

alter table public.organization_invitations enable row level security;
revoke all on public.organization_invitations from public, anon, authenticated;
grant select on public.organization_invitations to authenticated;

create policy "organization managers can read invitations"
on public.organization_invitations for select to authenticated
using (
  private.has_org_role(
    organization_id,
    array['OWNER','ADMIN']::public.organization_member_role[]
  )
);

create or replace function private.list_organization_members(target_org uuid)
returns table (
  membership_id uuid,
  user_id uuid,
  email text,
  display_name text,
  role public.organization_member_role,
  status public.organization_member_status,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if target_org is null
     or not private.has_org_role(
       target_org,
       array['OWNER','ADMIN']::public.organization_member_role[]
     ) then
    raise exception 'Only active organization OWNERs and ADMINs can view the member directory'
      using errcode = '42501';
  end if;

  return query
  select m.id, m.user_id, u.email, u.display_name, m.role, m.status, m.created_at
  from public.organization_memberships m
  join public.app_users u on u.id = m.user_id
  where m.organization_id = target_org
  order by
    case m.role when 'OWNER' then 0 when 'ADMIN' then 1 else 2 end,
    m.created_at asc;
end;
$function$;

create or replace function public.list_organization_members(target_org uuid)
returns table (
  membership_id uuid,
  user_id uuid,
  email text,
  display_name text,
  role public.organization_member_role,
  status public.organization_member_status,
  created_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $function$
  select * from private.list_organization_members(target_org);
$function$;

revoke all on function private.list_organization_members(uuid) from public, anon, authenticated;
grant execute on function private.list_organization_members(uuid) to authenticated;
revoke all on function public.list_organization_members(uuid) from public, anon;
grant execute on function public.list_organization_members(uuid) to authenticated;

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
      and m.status in ('ACTIVE', 'SUSPENDED')
  ) then
    raise exception 'This email already belongs to an active or suspended organization member'
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

create or replace function public.create_organization_invitation(
  target_org uuid,
  target_email text,
  target_role public.organization_member_role
)
returns jsonb
language sql
security invoker
set search_path = ''
as $function$
  select private.create_organization_invitation(target_org, target_email, target_role);
$function$;

revoke all on function private.create_organization_invitation(uuid, text, public.organization_member_role)
  from public, anon, authenticated;
grant execute on function private.create_organization_invitation(uuid, text, public.organization_member_role)
  to authenticated;
revoke all on function public.create_organization_invitation(uuid, text, public.organization_member_role)
  from public, anon;
grant execute on function public.create_organization_invitation(uuid, text, public.organization_member_role)
  to authenticated;

create or replace function private.revoke_organization_invitation(target_invitation uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := private.current_app_user_id();
  target_org uuid;
  target_role public.organization_member_role;
  caller_role public.organization_member_role;
begin
  select i.organization_id, i.role into target_org, target_role
  from public.organization_invitations i
  where i.id = target_invitation and i.status = 'PENDING'
  for update;

  if target_org is null then
    raise exception 'Pending organization invitation not found' using errcode = 'P0002';
  end if;

  select m.role into caller_role
  from public.organization_memberships m
  where m.organization_id = target_org
    and m.user_id = caller_id
    and m.status = 'ACTIVE';

  if caller_role not in ('OWNER', 'ADMIN')
     or caller_role is null
     or (target_role = 'ADMIN' and caller_role <> 'OWNER') then
    raise exception 'You are not authorized to revoke this invitation' using errcode = '42501';
  end if;

  update public.organization_invitations
  set status = 'REVOKED', revoked_by = caller_id, revoked_at = now()
  where id = target_invitation;

  insert into public.audit_events (
    organization_id, actor_user_id, action, resource_type, resource_id, event_data
  )
  values (
    target_org, caller_id, 'ORGANIZATION_INVITATION_REVOKED',
    'organization_invitation', target_invitation::text,
    jsonb_build_object('role', target_role)
  );

  return true;
end;
$function$;

create or replace function public.revoke_organization_invitation(target_invitation uuid)
returns boolean
language sql
security invoker
set search_path = ''
as $function$
  select private.revoke_organization_invitation(target_invitation);
$function$;

revoke all on function private.revoke_organization_invitation(uuid) from public, anon, authenticated;
grant execute on function private.revoke_organization_invitation(uuid) to authenticated;
revoke all on function public.revoke_organization_invitation(uuid) from public, anon;
grant execute on function public.revoke_organization_invitation(uuid) to authenticated;

create or replace function private.accept_organization_invitation(target_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := private.current_app_user_id();
  claim_email text := lower(trim(coalesce(auth.jwt() ->> 'email', '')));
  invitation public.organization_invitations%rowtype;
  existing_membership public.organization_memberships%rowtype;
begin
  if caller_id is null then
    raise exception 'Authenticated application identity is required' using errcode = '28000';
  end if;
  if coalesce(auth.jwt() ->> 'email_verified', 'false') <> 'true' then
    raise exception 'Verify your email address with your identity provider before accepting an invitation'
      using errcode = '42501';
  end if;
  if target_token is null or length(target_token) <> 64 or claim_email = '' then
    raise exception 'Invalid invitation token or verified email' using errcode = '22023';
  end if;

  select * into invitation
  from public.organization_invitations i
  where i.token_hash = encode(extensions.digest(convert_to(target_token, 'UTF8'), 'sha256'), 'hex')
  for update;

  if not found or invitation.status <> 'PENDING' or invitation.expires_at <= now() then
    raise exception 'Invitation is invalid, expired or already used' using errcode = '22023';
  end if;
  if lower(invitation.email) <> claim_email then
    raise exception 'The verified sign-in email does not match this invitation' using errcode = '42501';
  end if;

  select * into existing_membership
  from public.organization_memberships m
  where m.organization_id = invitation.organization_id
    and m.user_id = caller_id
  for update;

  if found then
    if existing_membership.status <> 'REMOVED' then
      raise exception 'An existing membership must be managed by an organization administrator'
        using errcode = '23505';
    end if;

    update public.organization_memberships
    set role = invitation.role, status = 'ACTIVE', updated_at = now()
    where id = existing_membership.id;
  else
    insert into public.organization_memberships (organization_id, user_id, role, status)
    values (invitation.organization_id, caller_id, invitation.role, 'ACTIVE');
  end if;

  update public.organization_invitations
  set status = 'ACCEPTED', accepted_by = caller_id, accepted_at = now()
  where id = invitation.id;

  insert into public.audit_events (
    organization_id, actor_user_id, action, resource_type, resource_id, event_data
  )
  values (
    invitation.organization_id, caller_id, 'ORGANIZATION_INVITATION_ACCEPTED',
    'organization_invitation', invitation.id::text,
    jsonb_build_object('role', invitation.role)
  );

  return jsonb_build_object(
    'organizationId', invitation.organization_id,
    'membershipRole', invitation.role
  );
end;
$function$;

create or replace function public.accept_organization_invitation(target_token text)
returns jsonb
language sql
security invoker
set search_path = ''
as $function$
  select private.accept_organization_invitation(target_token);
$function$;

revoke all on function private.accept_organization_invitation(text) from public, anon, authenticated;
grant execute on function private.accept_organization_invitation(text) to authenticated;
revoke all on function public.accept_organization_invitation(text) from public, anon;
grant execute on function public.accept_organization_invitation(text) to authenticated;

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
     or target_role is null or target_role not in ('ADMIN', 'BILLING_MANAGER', 'MEMBER')
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
    if target_role <> 'MEMBER' or target_status = 'ACTIVE' then
      raise exception 'Owner role changes require the dedicated ownership governance flow' using errcode = '22023';
    end if;
    select count(*) into active_owner_count
    from public.organization_memberships m
    where m.organization_id = target_org
      and m.role = 'OWNER'
      and m.status = 'ACTIVE';
    if active_owner_count <= 1 then
      raise exception 'The organization must retain at least one active OWNER' using errcode = '23514';
    end if;
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

create or replace function public.update_organization_membership(
  target_org uuid,
  target_user uuid,
  target_role public.organization_member_role,
  target_status public.organization_member_status
)
returns jsonb
language sql
security invoker
set search_path = ''
as $function$
  select private.update_organization_membership(target_org, target_user, target_role, target_status);
$function$;

revoke all on function private.update_organization_membership(uuid, uuid, public.organization_member_role, public.organization_member_status)
  from public, anon, authenticated;
grant execute on function private.update_organization_membership(uuid, uuid, public.organization_member_role, public.organization_member_status)
  to authenticated;
revoke all on function public.update_organization_membership(uuid, uuid, public.organization_member_role, public.organization_member_status)
  from public, anon;
grant execute on function public.update_organization_membership(uuid, uuid, public.organization_member_role, public.organization_member_status)
  to authenticated;
