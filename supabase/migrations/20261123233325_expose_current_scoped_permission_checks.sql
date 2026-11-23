create or replace function public.has_current_event_permission(
  target_event uuid,
  target_permission text
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $function$
  select case
    when target_permission in (
      'event.read',
      'event.update',
      'process.create',
      'process.read',
      'process.update',
      'process.submit',
      'process.lifecycle.read',
      'ballot_structure.read',
      'ballot_structure.manage',
      'contest.read',
      'contest.manage',
      'voter_register.manage',
      'voter_pii.read',
      'audit.read',
      'observer.status.read'
    )
    then private.has_event_permission(target_event, target_permission)
    else false
  end;
$function$;

create or replace function public.has_current_process_permission(
  target_process uuid,
  target_permission text
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $function$
  select case
    when target_permission in (
      'event.read',
      'event.update',
      'process.create',
      'process.read',
      'process.update',
      'process.submit',
      'process.lifecycle.read',
      'ballot_structure.read',
      'ballot_structure.manage',
      'contest.read',
      'contest.manage',
      'voter_register.manage',
      'voter_pii.read',
      'audit.read',
      'observer.status.read'
    )
    then private.has_process_permission(target_process, target_permission)
    else false
  end;
$function$;

revoke all on function public.has_current_event_permission(uuid, text) from public, anon;
revoke all on function public.has_current_process_permission(uuid, text) from public, anon;
grant execute on function public.has_current_event_permission(uuid, text) to authenticated;
grant execute on function public.has_current_process_permission(uuid, text) to authenticated;
