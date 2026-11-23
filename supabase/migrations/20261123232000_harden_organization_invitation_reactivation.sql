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
    if existing_membership.role in ('OWNER', 'ADMIN') then
      raise exception 'An existing OWNER or ADMIN must be explicitly demoted by an OWNER before re-invitation'
        using errcode = '42501';
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
