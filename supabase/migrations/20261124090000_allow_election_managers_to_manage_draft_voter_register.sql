-- Allow assigned Election Managers to maintain draft voter registers.
-- Viewing/exporting voter PII remains separately gated by active, purpose-bound grants.

insert into private.scoped_role_permissions (role, permission)
values ('ELECTION_MANAGER', 'voter_register.manage')
on conflict (role, permission) do nothing;

drop policy if exists "organization admins can add voter register entries"
  on public.voter_register_entries;

create policy "authorized managers can add draft voter register entries"
on public.voter_register_entries
for insert
to authenticated
with check (
  created_by = (select private.current_app_user_id())
  and exists (
    select 1
    from public.voting_processes p
    join public.voting_events e on e.id = p.event_id
    where p.id = voter_register_entries.process_id
      and p.status = 'DRAFT'
      and (
        private.has_org_role(
          e.organization_id,
          array['OWNER', 'ADMIN']::public.organization_member_role[]
        )
        or private.has_process_permission(p.id, 'voter_register.manage')
      )
  )
);

drop policy if exists "organization admins can update voter register entries"
  on public.voter_register_entries;

create policy "authorized managers can update draft voter register entries"
on public.voter_register_entries
for update
to authenticated
using (
  exists (
    select 1
    from public.voting_processes p
    join public.voting_events e on e.id = p.event_id
    where p.id = voter_register_entries.process_id
      and p.status = 'DRAFT'
      and (
        private.has_org_role(
          e.organization_id,
          array['OWNER', 'ADMIN']::public.organization_member_role[]
        )
        or private.has_process_permission(p.id, 'voter_register.manage')
      )
  )
)
with check (
  exists (
    select 1
    from public.voting_processes p
    join public.voting_events e on e.id = p.event_id
    where p.id = voter_register_entries.process_id
      and p.status = 'DRAFT'
      and (
        private.has_org_role(
          e.organization_id,
          array['OWNER', 'ADMIN']::public.organization_member_role[]
        )
        or private.has_process_permission(p.id, 'voter_register.manage')
      )
  )
);

-- Keep an immutable, PII-minimized audit trail for voter-register mutations.
create or replace function private.audit_voter_register_entry_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  target_organization_id uuid;
  changed_fields text[];
begin
  select e.organization_id
  into target_organization_id
  from public.voting_processes p
  join public.voting_events e on e.id = p.event_id
  where p.id = new.process_id;

  if target_organization_id is null then
    raise exception 'Voter register process organization could not be resolved'
      using errcode = '23503';
  end if;

  if tg_op = 'INSERT' then
    changed_fields := array['created']::text[];
  else
    changed_fields := array_remove(array[
      case when old.external_reference is distinct from new.external_reference then 'external_reference' end,
      case when old.display_name is distinct from new.display_name then 'display_name' end,
      case when old.contact_email is distinct from new.contact_email then 'contact_email' end,
      case when old.contact_phone is distinct from new.contact_phone then 'contact_phone' end,
      case when old.eligibility_status is distinct from new.eligibility_status then 'eligibility_status' end,
      case when old.source is distinct from new.source then 'source' end
    ], null);
  end if;

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
    target_organization_id,
    (select private.current_app_user_id()),
    case when tg_op = 'INSERT'
      then 'VOTER_REGISTER_ENTRY_CREATED'
      else 'VOTER_REGISTER_ENTRY_UPDATED'
    end,
    'voting_process',
    new.process_id::text,
    jsonb_build_object(
      'entry_id', new.id,
      'changed_fields', changed_fields,
      'eligibility_status', new.eligibility_status,
      'source', new.source
    ),
    now()
  );

  return new;
end;
$function$;

revoke all on function private.audit_voter_register_entry_change()
  from public, anon, authenticated;

drop trigger if exists voter_register_entries_audit_changes
  on public.voter_register_entries;

create trigger voter_register_entries_audit_changes
after insert or update on public.voter_register_entries
for each row execute function private.audit_voter_register_entry_change();
