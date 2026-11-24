-- Pending snapshots are bound to the process configuration captured at request time.
-- Any change to assurance or eligibility mode invalidates pending approval; an event move
-- is forbidden once a process has any snapshot history.

create or replace function private.guard_finalized_voter_register_configuration()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.event_id is distinct from old.event_id and exists (
    select 1
    from public.voter_register_snapshots s
    where s.process_id = old.id
  ) then
    raise exception 'A process with voter-register snapshot history cannot be moved to another event'
      using errcode = '42501';
  end if;

  if (
    new.assurance_tier is distinct from old.assurance_tier
    or new.eligibility_mode is distinct from old.eligibility_mode
  ) and exists (
    select 1
    from public.voter_register_snapshots s
    where s.process_id = old.id
      and s.status = 'FINALIZED'
      and s.register_revision = old.voter_register_revision
  ) then
    raise exception 'Reopen the finalized voter register before changing its eligibility mode or assurance tier'
      using errcode = '42501';
  end if;

  return new;
end;
$function$;

drop trigger if exists voting_process_prevent_snapshot_event_move
  on public.voting_processes;
create trigger voting_process_prevent_snapshot_event_move
before update of event_id on public.voting_processes
for each row execute function private.guard_finalized_voter_register_configuration();

create or replace function private.stale_pending_voter_register_snapshot_on_process_config_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  target_organization uuid;
begin
  if (
    new.assurance_tier is distinct from old.assurance_tier
    or new.eligibility_mode is distinct from old.eligibility_mode
  ) then
    update public.voter_register_snapshots
    set status = 'STALE', resolved_at = now()
    where process_id = new.id
      and status = 'PENDING_APPROVAL';

    if found then
      select e.organization_id into target_organization
      from public.voting_events e
      where e.id = old.event_id;

      insert into public.audit_events (
        organization_id, actor_user_id, action, resource_type, resource_id, event_data, occurred_at
      )
      values (
        target_organization,
        private.current_app_user_id(),
        'VOTER_REGISTER_FINALIZATION_STALE',
        'voting_process',
        new.id::text,
        jsonb_build_object('reason', 'process_configuration_changed'),
        now()
      );
    end if;
  end if;

  return new;
end;
$function$;

drop trigger if exists voting_process_stale_pending_register_snapshot
  on public.voting_processes;
create trigger voting_process_stale_pending_register_snapshot
after update of assurance_tier, eligibility_mode on public.voting_processes
for each row execute function private.stale_pending_voter_register_snapshot_on_process_config_change();

revoke all on function private.guard_finalized_voter_register_configuration()
  from public, anon, authenticated;
revoke all on function private.stale_pending_voter_register_snapshot_on_process_config_change()
  from public, anon, authenticated;
