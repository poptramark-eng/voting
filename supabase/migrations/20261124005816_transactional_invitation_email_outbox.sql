-- Durable, encrypted delivery queue for organization invitation emails.
-- The invitation token remains one-way hashed in the invitation table. A separately
-- encrypted copy is retained only until delivery succeeds or the invitation is invalidated.

do $migration$
begin
  if not exists (
    select 1 from vault.secrets
    where name = 'organization_invitation_delivery_key'
  ) then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'organization_invitation_delivery_key',
      'Encrypts short-lived organization invitation tokens for transactional email delivery.'
    );
  end if;
end;
$migration$;

create table public.organization_invitation_email_outbox (
  id uuid primary key default gen_random_uuid(),
  invitation_id uuid not null unique
    references public.organization_invitations(id) on delete cascade,
  status text not null default 'QUEUED'
    check (status in ('QUEUED', 'PROCESSING', 'RETRY', 'SENT', 'FAILED', 'CANCELLED')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  lock_token uuid,
  provider_email_id text,
  last_error text check (last_error is null or length(last_error) <= 500),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  constraint invitation_outbox_processing_lock_shape check (
    (status = 'PROCESSING' and locked_at is not null and lock_token is not null)
    or (status <> 'PROCESSING' and locked_at is null and lock_token is null)
  ),
  constraint invitation_outbox_sent_shape check (
    (status = 'SENT' and sent_at is not null)
    or (status <> 'SENT' and sent_at is null)
  )
);

create index organization_invitation_outbox_ready_idx
  on public.organization_invitation_email_outbox (available_at, created_at)
  where status in ('QUEUED', 'RETRY');

alter table public.organization_invitation_email_outbox enable row level security;
revoke all on public.organization_invitation_email_outbox from public, anon, authenticated, service_role;

create table private.organization_invitation_delivery_secrets (
  invitation_id uuid primary key
    references public.organization_invitations(id) on delete cascade,
  encrypted_token bytea not null,
  created_at timestamptz not null default now()
);

alter table private.organization_invitation_delivery_secrets enable row level security;
revoke all on private.organization_invitation_delivery_secrets from public, anon, authenticated, service_role;

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
  encryption_key text;
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

  select decrypted_secret into encryption_key
  from vault.decrypted_secrets
  where name = 'organization_invitation_delivery_key';

  if encryption_key is null then
    raise exception 'Invitation delivery encryption is not configured'
      using errcode = '55000';
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

  insert into private.organization_invitation_delivery_secrets (invitation_id, encrypted_token)
  values (invitation_id, extensions.pgp_sym_encrypt(raw_token, encryption_key));

  insert into public.organization_invitation_email_outbox (invitation_id)
  values (invitation_id);

  insert into public.audit_events (
    organization_id, actor_user_id, action, resource_type, resource_id, event_data
  )
  values (
    target_org, caller_id, 'ORGANIZATION_INVITATION_CREATED',
    'organization_invitation', invitation_id::text,
    jsonb_build_object(
      'email', normalized_email,
      'role', target_role,
      'expires_at', invitation_expiry,
      'delivery', 'QUEUED'
    )
  );

  return jsonb_build_object(
    'invitationId', invitation_id,
    'token', raw_token,
    'email', normalized_email,
    'role', target_role,
    'expiresAt', invitation_expiry,
    'delivery', 'QUEUED'
  );
end;
$function$;

create or replace function private.claim_organization_invitation_email_outbox(target_limit integer default 10)
returns table (
  outbox_id uuid,
  lock_token uuid,
  invitation_id uuid,
  email text,
  role public.organization_member_role,
  organization_name text,
  token text
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  encryption_key text;
begin
  if target_limit is null or target_limit < 1 or target_limit > 50 then
    raise exception 'Batch size must be between 1 and 50' using errcode = '22023';
  end if;

  select decrypted_secret into encryption_key
  from vault.decrypted_secrets
  where name = 'organization_invitation_delivery_key';

  if encryption_key is null then
    raise exception 'Invitation delivery encryption is not configured' using errcode = '55000';
  end if;

  update public.organization_invitation_email_outbox o
  set status = 'RETRY', available_at = now(), locked_at = null, lock_token = null
  where o.status = 'PROCESSING'
    and o.locked_at < now() - interval '10 minutes';

  with cancelled as (
    update public.organization_invitation_email_outbox o
    set status = 'CANCELLED', locked_at = null, lock_token = null
    where o.status in ('QUEUED', 'RETRY')
      and not exists (
        select 1 from public.organization_invitations i
        where i.id = o.invitation_id
          and i.status = 'PENDING'
          and i.expires_at > now()
      )
    returning o.invitation_id
  )
  delete from private.organization_invitation_delivery_secrets s
  using cancelled c
  where s.invitation_id = c.invitation_id;

  return query
  with candidates as (
    select o.id
    from public.organization_invitation_email_outbox o
    join public.organization_invitations i on i.id = o.invitation_id
    where o.status in ('QUEUED', 'RETRY')
      and o.available_at <= now()
      and i.status = 'PENDING'
      and i.expires_at > now()
    order by o.created_at
    for update of o skip locked
    limit target_limit
  ),
  claimed as (
    update public.organization_invitation_email_outbox o
    set status = 'PROCESSING',
        attempt_count = o.attempt_count + 1,
        locked_at = now(),
        lock_token = gen_random_uuid()
    from candidates c
    where o.id = c.id
    returning o.id, o.lock_token, o.invitation_id
  )
  select
    c.id,
    c.lock_token,
    i.id,
    i.email,
    i.role,
    org.name,
    extensions.pgp_sym_decrypt(s.encrypted_token, encryption_key)
  from claimed c
  join public.organization_invitations i on i.id = c.invitation_id
  join public.organizations org on org.id = i.organization_id
  join private.organization_invitation_delivery_secrets s on s.invitation_id = i.id;
end;
$function$;

create or replace function private.complete_organization_invitation_email_outbox(
  target_outbox uuid,
  target_lock_token uuid,
  target_provider_email_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  target_invitation uuid;
begin
  update public.organization_invitation_email_outbox
  set status = 'SENT',
      provider_email_id = nullif(trim(target_provider_email_id), ''),
      sent_at = now(),
      locked_at = null,
      lock_token = null,
      last_error = null
  where id = target_outbox
    and status = 'PROCESSING'
    and lock_token = target_lock_token
  returning invitation_id into target_invitation;

  if target_invitation is null then
    raise exception 'Invitation email outbox lease not found' using errcode = 'P0002';
  end if;

  delete from private.organization_invitation_delivery_secrets
  where invitation_id = target_invitation;

  return true;
end;
$function$;

create or replace function private.fail_organization_invitation_email_outbox(
  target_outbox uuid,
  target_lock_token uuid,
  target_error text
)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_row public.organization_invitation_email_outbox%rowtype;
  target_org uuid;
begin
  select * into current_row
  from public.organization_invitation_email_outbox
  where id = target_outbox
    and status = 'PROCESSING'
    and lock_token = target_lock_token
  for update;

  if not found then
    raise exception 'Invitation email outbox lease not found' using errcode = 'P0002';
  end if;

  if current_row.attempt_count >= 8 then
    update public.organization_invitation_email_outbox
    set status = 'FAILED',
        last_error = left(coalesce(target_error, 'Email delivery failed'), 500),
        locked_at = null,
        lock_token = null
    where id = target_outbox;

    update public.organization_invitations
    set status = 'EXPIRED'
    where id = current_row.invitation_id
      and status = 'PENDING';

    select organization_id into target_org
    from public.organization_invitations
    where id = current_row.invitation_id;

    insert into public.audit_events (
      organization_id, action, resource_type, resource_id, event_data
    )
    values (
      target_org,
      'ORGANIZATION_INVITATION_DELIVERY_FAILED',
      'organization_invitation',
      current_row.invitation_id::text,
      jsonb_build_object('attempt_count', current_row.attempt_count)
    );

    delete from private.organization_invitation_delivery_secrets
    where invitation_id = current_row.invitation_id;

    return 'FAILED';
  end if;

  update public.organization_invitation_email_outbox
  set status = 'RETRY',
      available_at = now() + make_interval(
        secs => least(3600, (60 * power(2, current_row.attempt_count - 1))::integer)
      ),
      last_error = left(coalesce(target_error, 'Email delivery failed'), 500),
      locked_at = null,
      lock_token = null
  where id = target_outbox;

  return 'RETRY';
end;
$function$;

create or replace function public.claim_organization_invitation_email_outbox(target_limit integer default 10)
returns table (
  outbox_id uuid,
  lock_token uuid,
  invitation_id uuid,
  email text,
  role public.organization_member_role,
  organization_name text,
  token text
)
language sql
security invoker
set search_path = ''
as $function$
  select * from private.claim_organization_invitation_email_outbox(target_limit);
$function$;

create or replace function public.complete_organization_invitation_email_outbox(
  target_outbox uuid,
  target_lock_token uuid,
  target_provider_email_id text
)
returns boolean
language sql
security invoker
set search_path = ''
as $function$
  select private.complete_organization_invitation_email_outbox(
    target_outbox, target_lock_token, target_provider_email_id
  );
$function$;

create or replace function public.fail_organization_invitation_email_outbox(
  target_outbox uuid,
  target_lock_token uuid,
  target_error text
)
returns text
language sql
security invoker
set search_path = ''
as $function$
  select private.fail_organization_invitation_email_outbox(
    target_outbox, target_lock_token, target_error
  );
$function$;

grant usage on schema private to service_role;

revoke all on function private.claim_organization_invitation_email_outbox(integer)
  from public, anon, authenticated, service_role;
grant execute on function private.claim_organization_invitation_email_outbox(integer)
  to service_role;
revoke all on function private.complete_organization_invitation_email_outbox(uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function private.complete_organization_invitation_email_outbox(uuid, uuid, text)
  to service_role;
revoke all on function private.fail_organization_invitation_email_outbox(uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function private.fail_organization_invitation_email_outbox(uuid, uuid, text)
  to service_role;

revoke all on function public.claim_organization_invitation_email_outbox(integer)
  from public, anon, authenticated;
grant execute on function public.claim_organization_invitation_email_outbox(integer)
  to service_role;
revoke all on function public.complete_organization_invitation_email_outbox(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.complete_organization_invitation_email_outbox(uuid, uuid, text)
  to service_role;
revoke all on function public.fail_organization_invitation_email_outbox(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.fail_organization_invitation_email_outbox(uuid, uuid, text)
  to service_role;
