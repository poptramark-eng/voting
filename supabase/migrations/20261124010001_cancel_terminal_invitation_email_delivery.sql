-- Cancel queued invitation deliveries when an invitation is accepted, revoked or expires.
-- A lease check lets workers avoid sending a link after a concurrent terminal transition.

create or replace function private.cancel_organization_invitation_email_delivery()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if old.status = 'PENDING' and new.status in ('ACCEPTED', 'REVOKED', 'EXPIRED') then
    update public.organization_invitation_email_outbox
    set status = 'CANCELLED',
        locked_at = null,
        lock_token = null,
        last_error = 'Invitation is no longer pending'
    where invitation_id = new.id
      and status in ('QUEUED', 'RETRY', 'PROCESSING');

    delete from private.organization_invitation_delivery_secrets
    where invitation_id = new.id;
  end if;

  return new;
end;
$function$;

revoke all on function private.cancel_organization_invitation_email_delivery()
  from public, anon, authenticated, service_role;

create trigger cancel_organization_invitation_email_delivery
after update of status on public.organization_invitations
for each row
execute function private.cancel_organization_invitation_email_delivery();

create or replace function private.is_organization_invitation_email_lease_valid(
  target_outbox uuid,
  target_lock_token uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.organization_invitation_email_outbox o
    join public.organization_invitations i on i.id = o.invitation_id
    where o.id = target_outbox
      and o.status = 'PROCESSING'
      and o.lock_token = target_lock_token
      and i.status = 'PENDING'
      and i.expires_at > now()
  );
$function$;

create or replace function public.is_organization_invitation_email_lease_valid(
  target_outbox uuid,
  target_lock_token uuid
)
returns boolean
language sql
security invoker
set search_path = ''
as $function$
  select private.is_organization_invitation_email_lease_valid(target_outbox, target_lock_token);
$function$;

revoke all on function private.is_organization_invitation_email_lease_valid(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.is_organization_invitation_email_lease_valid(uuid, uuid)
  to service_role;
revoke all on function public.is_organization_invitation_email_lease_valid(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.is_organization_invitation_email_lease_valid(uuid, uuid)
  to service_role;
