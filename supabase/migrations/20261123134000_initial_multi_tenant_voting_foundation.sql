-- Lock direct client updates to draft configuration only.
-- Status transitions must go through the trusted workflow service until
-- explicit transition RPCs and approval rules are implemented.
drop policy if exists "authorized managers can update draft voting events" on public.voting_events;
create policy "authorized managers can update draft voting events"
on public.voting_events for update to authenticated
using (
  status = 'DRAFT'
  and public.has_org_role(organization_id, array['OWNER','ADMIN','ELECTION_MANAGER']::public.organization_member_role[])
)
with check (
  status = 'DRAFT'
  and public.has_org_role(organization_id, array['OWNER','ADMIN','ELECTION_MANAGER']::public.organization_member_role[])
);

drop policy if exists "authorized managers can update draft voting processes" on public.voting_processes;
create policy "authorized managers can update draft voting processes"
on public.voting_processes for update to authenticated
using (
  status = 'DRAFT'
  and exists (
    select 1 from public.voting_events e
    where e.id = event_id
      and public.has_org_role(e.organization_id, array['OWNER','ADMIN','ELECTION_MANAGER']::public.organization_member_role[])
  )
)
with check (
  status = 'DRAFT'
  and exists (
    select 1 from public.voting_events e
    where e.id = event_id
      and public.has_org_role(e.organization_id, array['OWNER','ADMIN','ELECTION_MANAGER']::public.organization_member_role[])
  )
);