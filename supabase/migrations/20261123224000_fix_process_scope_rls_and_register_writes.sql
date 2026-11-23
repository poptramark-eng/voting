-- Resolve process scope inside private SECURITY DEFINER helpers.
-- RLS subqueries over voting_processes were hiding the row from scoped managers
-- while the same policy was trying to authorize access through that row.

create or replace function private.can_access_voting_process(
  target_process uuid,
  target_permission text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.voting_processes p
    join public.voting_events e on e.id = p.event_id
    where p.id = target_process
      and (
        private.has_org_role(
          e.organization_id,
          array['OWNER', 'ADMIN']::public.organization_member_role[]
        )
        or private.has_process_permission(p.id, target_permission)
      )
  );
$function$;

revoke all on function private.can_access_voting_process(uuid, text)
  from public, anon;
grant execute on function private.can_access_voting_process(uuid, text)
  to authenticated;

create or replace function private.can_manage_draft_voter_register(
  target_process uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.voting_processes p
    join public.voting_events e on e.id = p.event_id
    where p.id = target_process
      and p.status = 'DRAFT'
      and (
        private.has_org_role(
          e.organization_id,
          array['OWNER', 'ADMIN']::public.organization_member_role[]
        )
        or private.has_process_permission(p.id, 'voter_register.manage')
      )
  );
$function$;

revoke all on function private.can_manage_draft_voter_register(uuid)
  from public, anon;
grant execute on function private.can_manage_draft_voter_register(uuid)
  to authenticated;

drop policy if exists "scoped members can read voting processes"
  on public.voting_processes;

create policy "scoped members can read voting processes"
on public.voting_processes
for select
to authenticated
using (
  private.can_access_voting_process(id, 'process.read')
);

drop policy if exists "scoped managers can update draft voting processes"
  on public.voting_processes;

create policy "scoped managers can update draft voting processes"
on public.voting_processes
for update
to authenticated
using (
  status = 'DRAFT'
  and private.can_access_voting_process(id, 'process.update')
)
with check (
  status = 'DRAFT'
  and private.can_access_voting_process(id, 'process.update')
);

drop policy if exists "authorized managers can add draft voter register entries"
  on public.voter_register_entries;

create policy "authorized managers can add draft voter register entries"
on public.voter_register_entries
for insert
to authenticated
with check (
  created_by = (select private.current_app_user_id())
  and private.can_manage_draft_voter_register(process_id)
);

drop policy if exists "authorized managers can update draft voter register entries"
  on public.voter_register_entries;

create policy "authorized managers can update draft voter register entries"
on public.voter_register_entries
for update
to authenticated
using (
  private.can_manage_draft_voter_register(process_id)
)
with check (
  private.can_manage_draft_voter_register(process_id)
);
