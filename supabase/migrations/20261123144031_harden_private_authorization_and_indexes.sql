-- Move internal authorization helpers out of the exposed public API schema.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

alter function public.is_active_org_member(uuid) set schema private;
alter function public.has_org_role(uuid, public.organization_member_role[]) set schema private;

revoke all on function private.is_active_org_member(uuid) from public, anon;
revoke all on function private.has_org_role(uuid, public.organization_member_role[]) from public, anon;
grant execute on function private.is_active_org_member(uuid) to authenticated;
grant execute on function private.has_org_role(uuid, public.organization_member_role[]) to authenticated;

-- Add covering indexes for foreign keys used in ownership and audit lookups.
create index if not exists organizations_created_by_idx on public.organizations(created_by);
create index if not exists voting_events_created_by_idx on public.voting_events(created_by);
create index if not exists voting_processes_created_by_idx on public.voting_processes(created_by);
create index if not exists voter_register_entries_created_by_idx on public.voter_register_entries(created_by);
create index if not exists audit_events_actor_user_id_idx on public.audit_events(actor_user_id);

-- Avoid overlapping permissive SELECT policies by separating write actions.
drop policy if exists "authorized managers can manage contests" on public.contests;
create policy "authorized managers can create contests"
on public.contests for insert to authenticated
with check (
  exists (
    select 1 from public.voting_processes p
    join public.voting_events e on e.id = p.event_id
    where p.id = process_id
      and p.status = 'DRAFT'
      and private.has_org_role(e.organization_id, array['OWNER','ADMIN','ELECTION_MANAGER']::public.organization_member_role[])
  )
);
create policy "authorized managers can update contests"
on public.contests for update to authenticated
using (
  exists (
    select 1 from public.voting_processes p
    join public.voting_events e on e.id = p.event_id
    where p.id = process_id
      and p.status = 'DRAFT'
      and private.has_org_role(e.organization_id, array['OWNER','ADMIN','ELECTION_MANAGER']::public.organization_member_role[])
  )
)
with check (
  exists (
    select 1 from public.voting_processes p
    join public.voting_events e on e.id = p.event_id
    where p.id = process_id
      and p.status = 'DRAFT'
      and private.has_org_role(e.organization_id, array['OWNER','ADMIN','ELECTION_MANAGER']::public.organization_member_role[])
  )
);

drop policy if exists "authorized managers can manage ballot items" on public.ballot_items;
create policy "authorized managers can create ballot items"
on public.ballot_items for insert to authenticated
with check (
  exists (
    select 1 from public.contests c
    join public.voting_processes p on p.id = c.process_id
    join public.voting_events e on e.id = p.event_id
    where c.id = contest_id
      and p.status = 'DRAFT'
      and private.has_org_role(e.organization_id, array['OWNER','ADMIN','ELECTION_MANAGER']::public.organization_member_role[])
  )
);
create policy "authorized managers can update ballot items"
on public.ballot_items for update to authenticated
using (
  exists (
    select 1 from public.contests c
    join public.voting_processes p on p.id = c.process_id
    join public.voting_events e on e.id = p.event_id
    where c.id = contest_id
      and p.status = 'DRAFT'
      and private.has_org_role(e.organization_id, array['OWNER','ADMIN','ELECTION_MANAGER']::public.organization_member_role[])
  )
)
with check (
  exists (
    select 1 from public.contests c
    join public.voting_processes p on p.id = c.process_id
    join public.voting_events e on e.id = p.event_id
    where c.id = contest_id
      and p.status = 'DRAFT'
      and private.has_org_role(e.organization_id, array['OWNER','ADMIN','ELECTION_MANAGER']::public.organization_member_role[])
  )
);

drop policy if exists "authorized managers can manage voter registers in draft processes" on public.voter_register_entries;
create policy "authorized managers can add voter register entries"
on public.voter_register_entries for insert to authenticated
with check (
  exists (
    select 1 from public.voting_processes p
    join public.voting_events e on e.id = p.event_id
    where p.id = process_id
      and p.status = 'DRAFT'
      and private.has_org_role(e.organization_id, array['OWNER','ADMIN','ELECTION_MANAGER']::public.organization_member_role[])
  )
  and created_by = (select auth.uid())
);
create policy "authorized managers can update voter register entries"
on public.voter_register_entries for update to authenticated
using (
  exists (
    select 1 from public.voting_processes p
    join public.voting_events e on e.id = p.event_id
    where p.id = process_id
      and p.status = 'DRAFT'
      and private.has_org_role(e.organization_id, array['OWNER','ADMIN','ELECTION_MANAGER']::public.organization_member_role[])
  )
)
with check (
  exists (
    select 1 from public.voting_processes p
    join public.voting_events e on e.id = p.event_id
    where p.id = process_id
      and p.status = 'DRAFT'
      and private.has_org_role(e.organization_id, array['OWNER','ADMIN','ELECTION_MANAGER']::public.organization_member_role[])
  )
);

-- Keep deletion unavailable to ordinary authenticated clients; use audited workflows later.
revoke delete on public.contests, public.ballot_items, public.voter_register_entries from authenticated;
