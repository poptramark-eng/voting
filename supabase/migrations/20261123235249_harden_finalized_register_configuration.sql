-- Index the new snapshot foreign keys and prevent configuration drift after finalization.

create index voter_register_snapshots_organization_idx
  on public.voter_register_snapshots(organization_id);
create index voter_register_snapshots_event_idx
  on public.voter_register_snapshots(event_id);
create index voter_register_snapshots_requested_by_idx
  on public.voter_register_snapshots(requested_by);
create index voter_register_snapshots_reopened_by_idx
  on public.voter_register_snapshots(reopened_by);
create index voter_register_snapshot_approvals_approver_idx
  on public.voter_register_snapshot_approvals(approver_user_id);

create or replace function private.guard_finalized_voter_register_configuration()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
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

drop trigger if exists voting_process_guard_finalized_register_configuration
  on public.voting_processes;
create trigger voting_process_guard_finalized_register_configuration
before update of assurance_tier, eligibility_mode on public.voting_processes
for each row execute function private.guard_finalized_voter_register_configuration();

create or replace function private.require_finalized_voter_register_before_submission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if old.status = 'DRAFT'
     and new.status = 'PENDING_APPROVAL'
     and new.eligibility_mode in ('MANAGED_REGISTER','COMBINED')
     and not exists (
       select 1
       from public.voter_register_snapshots s
       where s.process_id = new.id
         and s.status = 'FINALIZED'
         and s.register_revision = new.voter_register_revision
         and s.assurance_tier = new.assurance_tier
     ) then
    raise exception 'A current, approved voter register snapshot matching the process assurance tier is required before process submission'
      using errcode = '22023';
  end if;
  return new;
end;
$function$;

revoke all on function private.guard_finalized_voter_register_configuration()
  from public, anon, authenticated;
revoke all on function private.require_finalized_voter_register_before_submission()
  from public, anon, authenticated;
