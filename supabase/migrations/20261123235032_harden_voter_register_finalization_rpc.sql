-- Keep public PostgREST entry points SECURITY INVOKER.
-- Move the validated, privileged implementations into the non-exposed private schema.

alter function public.request_voter_register_finalization(uuid, text) set schema private;
alter function private.request_voter_register_finalization(uuid, text)
  rename to request_voter_register_finalization_impl;

alter function public.decide_voter_register_finalization(uuid, text, text) set schema private;
alter function private.decide_voter_register_finalization(uuid, text, text)
  rename to decide_voter_register_finalization_impl;

alter function public.reopen_voter_register_snapshot(uuid, text) set schema private;
alter function private.reopen_voter_register_snapshot(uuid, text)
  rename to reopen_voter_register_snapshot_impl;

revoke all on function private.request_voter_register_finalization_impl(uuid, text)
  from public, anon, authenticated;
revoke all on function private.decide_voter_register_finalization_impl(uuid, text, text)
  from public, anon, authenticated;
revoke all on function private.reopen_voter_register_snapshot_impl(uuid, text)
  from public, anon, authenticated;

grant execute on function private.request_voter_register_finalization_impl(uuid, text)
  to authenticated;
grant execute on function private.decide_voter_register_finalization_impl(uuid, text, text)
  to authenticated;
grant execute on function private.reopen_voter_register_snapshot_impl(uuid, text)
  to authenticated;

create or replace function public.request_voter_register_finalization(
  target_process uuid,
  target_reason text
)
returns uuid
language sql
security invoker
set search_path = ''
as $function$
  select private.request_voter_register_finalization_impl(target_process, target_reason);
$function$;

create or replace function public.decide_voter_register_finalization(
  target_snapshot uuid,
  target_decision text,
  target_comment text default null
)
returns uuid
language sql
security invoker
set search_path = ''
as $function$
  select private.decide_voter_register_finalization_impl(
    target_snapshot, target_decision, target_comment
  );
$function$;

create or replace function public.reopen_voter_register_snapshot(
  target_snapshot uuid,
  target_reason text
)
returns uuid
language sql
security invoker
set search_path = ''
as $function$
  select private.reopen_voter_register_snapshot_impl(target_snapshot, target_reason);
$function$;

revoke all on function public.request_voter_register_finalization(uuid, text)
  from public, anon;
revoke all on function public.decide_voter_register_finalization(uuid, text, text)
  from public, anon;
revoke all on function public.reopen_voter_register_snapshot(uuid, text)
  from public, anon;

grant execute on function public.request_voter_register_finalization(uuid, text)
  to authenticated;
grant execute on function public.decide_voter_register_finalization(uuid, text, text)
  to authenticated;
grant execute on function public.reopen_voter_register_snapshot(uuid, text)
  to authenticated;

create policy "no direct API access to voter snapshot PII"
on public.voter_register_snapshot_entries for all to anon, authenticated
using (false) with check (false);
