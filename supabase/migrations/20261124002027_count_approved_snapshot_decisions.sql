-- Approval progress counts only affirmative decisions; rejected requests have REJECTED status.
create or replace function private.read_voter_register_snapshot_summaries_impl(target_process uuid)
returns table (
 id uuid, version integer, status text, assurance_tier text, required_approvals smallint,
 register_revision bigint, total_entry_count integer, eligible_count integer,
 rejected_count integer, revoked_count integer, created_at timestamptz,
 finalized_at timestamptz, resolved_at timestamptz, reopened_at timestamptz,
 reopen_reason text, approval_count integer, requested_by_is_current_user boolean
)
language plpgsql security definer set search_path = ''
as $function$
declare caller_id uuid := private.current_app_user_id(); target_organization uuid; is_governor boolean;
begin
 if caller_id is null then raise exception 'Authenticated application identity is required' using errcode='28000'; end if;
 select e.organization_id into target_organization from public.voting_processes p
 join public.voting_events e on e.id=p.event_id where p.id=target_process;
 if not found then raise exception 'Voting process not found' using errcode='P0002'; end if;
 is_governor := private.has_org_role(target_organization,array['OWNER','ADMIN']::public.organization_member_role[]);
 if not is_governor and not private.has_process_permission(target_process,'process.read') then
  raise exception 'You do not have permission to read this register finalization history' using errcode='42501';
 end if;
 return query select s.id,s.version,s.status,s.assurance_tier::text,s.required_approvals,s.register_revision,
 s.total_entry_count,s.eligible_count,s.rejected_count,s.revoked_count,s.created_at,s.finalized_at,
 s.resolved_at,s.reopened_at,case when is_governor then s.reopen_reason else null end,
 (select count(*)::integer from public.voter_register_snapshot_approvals a
  where a.snapshot_id=s.id and a.decision='APPROVE'),s.requested_by=caller_id
 from public.voter_register_snapshots s where s.process_id=target_process order by s.version desc limit 20;
end;
$function$;
