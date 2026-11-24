-- Keep the authenticated API surface SECURITY INVOKER.
-- The reviewed privileged implementations move into the non-exposed private schema.
-- Each implementation retains its empty search_path and caller/role authorization checks.
-- service_role had no legitimate application call sites for these user-scoped operations;
-- remove its execute grant rather than expose private-schema helpers to it.

alter function public.approve_process_workflow_request(uuid, text, text) set schema private;
alter function private.approve_process_workflow_request(uuid, text, text) rename to approve_process_workflow_request_impl;
alter function public.assign_event_role(uuid, uuid, public.organization_member_role, timestamp with time zone) set schema private;
alter function private.assign_event_role(uuid, uuid, public.organization_member_role, timestamp with time zone) rename to assign_event_role_impl;
alter function public.assign_process_role(uuid, uuid, public.organization_member_role, timestamp with time zone) set schema private;
alter function private.assign_process_role(uuid, uuid, public.organization_member_role, timestamp with time zone) rename to assign_process_role_impl;
alter function public.close_expired_process(uuid) set schema private;
alter function private.close_expired_process(uuid) rename to close_expired_process_impl;
alter function public.create_organization(text, text) set schema private;
alter function private.create_organization(text, text) rename to create_organization_impl;
alter function public.decide_voter_pii_access_request(uuid, text, text) set schema private;
alter function private.decide_voter_pii_access_request(uuid, text, text) rename to decide_voter_pii_access_request_impl;
alter function public.emergency_suspend_process(uuid, text, jsonb) set schema private;
alter function private.emergency_suspend_process(uuid, text, jsonb) rename to emergency_suspend_process_impl;
alter function public.open_scheduled_process(uuid) set schema private;
alter function private.open_scheduled_process(uuid) rename to open_scheduled_process_impl;
alter function public.read_voter_register_entries(uuid, text, integer, integer) set schema private;
alter function private.read_voter_register_entries(uuid, text, integer, integer) rename to read_voter_register_entries_impl;
alter function public.request_process_resumption(uuid, text, text, jsonb) set schema private;
alter function private.request_process_resumption(uuid, text, text, jsonb) rename to request_process_resumption_impl;
alter function public.request_process_termination(uuid, text, jsonb) set schema private;
alter function private.request_process_termination(uuid, text, jsonb) rename to request_process_termination_impl;
alter function public.request_voter_pii_access(text, uuid, uuid, uuid, text[], text, timestamp with time zone) set schema private;
alter function private.request_voter_pii_access(text, uuid, uuid, uuid, text[], text, timestamp with time zone) rename to request_voter_pii_access_impl;
alter function public.revoke_event_role(uuid, uuid) set schema private;
alter function private.revoke_event_role(uuid, uuid) rename to revoke_event_role_impl;
alter function public.revoke_process_role(uuid, uuid) set schema private;
alter function private.revoke_process_role(uuid, uuid) rename to revoke_process_role_impl;
alter function public.revoke_voter_pii_access(uuid, text) set schema private;
alter function private.revoke_voter_pii_access(uuid, text) rename to revoke_voter_pii_access_impl;
alter function public.submit_process_for_approval(uuid) set schema private;
alter function private.submit_process_for_approval(uuid) rename to submit_process_for_approval_impl;

revoke all on function private.approve_process_workflow_request_impl(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function private.approve_process_workflow_request_impl(uuid, text, text) to authenticated;
revoke all on function private.assign_event_role_impl(uuid, uuid, public.organization_member_role, timestamp with time zone) from public, anon, authenticated, service_role;
grant execute on function private.assign_event_role_impl(uuid, uuid, public.organization_member_role, timestamp with time zone) to authenticated;
revoke all on function private.assign_process_role_impl(uuid, uuid, public.organization_member_role, timestamp with time zone) from public, anon, authenticated, service_role;
grant execute on function private.assign_process_role_impl(uuid, uuid, public.organization_member_role, timestamp with time zone) to authenticated;
revoke all on function private.close_expired_process_impl(uuid) from public, anon, authenticated, service_role;
grant execute on function private.close_expired_process_impl(uuid) to authenticated;
revoke all on function private.create_organization_impl(text, text) from public, anon, authenticated, service_role;
grant execute on function private.create_organization_impl(text, text) to authenticated;
revoke all on function private.decide_voter_pii_access_request_impl(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function private.decide_voter_pii_access_request_impl(uuid, text, text) to authenticated;
revoke all on function private.emergency_suspend_process_impl(uuid, text, jsonb) from public, anon, authenticated, service_role;
grant execute on function private.emergency_suspend_process_impl(uuid, text, jsonb) to authenticated;
revoke all on function private.open_scheduled_process_impl(uuid) from public, anon, authenticated, service_role;
grant execute on function private.open_scheduled_process_impl(uuid) to authenticated;
revoke all on function private.read_voter_register_entries_impl(uuid, text, integer, integer) from public, anon, authenticated, service_role;
grant execute on function private.read_voter_register_entries_impl(uuid, text, integer, integer) to authenticated;
revoke all on function private.request_process_resumption_impl(uuid, text, text, jsonb) from public, anon, authenticated, service_role;
grant execute on function private.request_process_resumption_impl(uuid, text, text, jsonb) to authenticated;
revoke all on function private.request_process_termination_impl(uuid, text, jsonb) from public, anon, authenticated, service_role;
grant execute on function private.request_process_termination_impl(uuid, text, jsonb) to authenticated;
revoke all on function private.request_voter_pii_access_impl(text, uuid, uuid, uuid, text[], text, timestamp with time zone) from public, anon, authenticated, service_role;
grant execute on function private.request_voter_pii_access_impl(text, uuid, uuid, uuid, text[], text, timestamp with time zone) to authenticated;
revoke all on function private.revoke_event_role_impl(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function private.revoke_event_role_impl(uuid, uuid) to authenticated;
revoke all on function private.revoke_process_role_impl(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function private.revoke_process_role_impl(uuid, uuid) to authenticated;
revoke all on function private.revoke_voter_pii_access_impl(uuid, text) from public, anon, authenticated, service_role;
grant execute on function private.revoke_voter_pii_access_impl(uuid, text) to authenticated;
revoke all on function private.submit_process_for_approval_impl(uuid) from public, anon, authenticated, service_role;
grant execute on function private.submit_process_for_approval_impl(uuid) to authenticated;

create or replace function public.approve_process_workflow_request(target_request uuid, decision text, comment text default null::text)
returns uuid
language sql
security invoker
set search_path = ''
as $function$
  select private.approve_process_workflow_request_impl(target_request, decision, comment);
$function$;
revoke all on function public.approve_process_workflow_request(uuid, text, text) from public, anon, service_role;
grant execute on function public.approve_process_workflow_request(uuid, text, text) to authenticated;

create or replace function public.assign_event_role(target_event uuid, target_user uuid, target_role public.organization_member_role, target_expires_at timestamp with time zone default null::timestamp with time zone)
returns uuid
language sql
security invoker
set search_path = ''
as $function$
  select private.assign_event_role_impl(target_event, target_user, target_role, target_expires_at);
$function$;
revoke all on function public.assign_event_role(uuid, uuid, public.organization_member_role, timestamp with time zone) from public, anon, service_role;
grant execute on function public.assign_event_role(uuid, uuid, public.organization_member_role, timestamp with time zone) to authenticated;

create or replace function public.assign_process_role(target_process uuid, target_user uuid, target_role public.organization_member_role, target_expires_at timestamp with time zone default null::timestamp with time zone)
returns uuid
language sql
security invoker
set search_path = ''
as $function$
  select private.assign_process_role_impl(target_process, target_user, target_role, target_expires_at);
$function$;
revoke all on function public.assign_process_role(uuid, uuid, public.organization_member_role, timestamp with time zone) from public, anon, service_role;
grant execute on function public.assign_process_role(uuid, uuid, public.organization_member_role, timestamp with time zone) to authenticated;

create or replace function public.close_expired_process(target_process uuid)
returns uuid
language sql
security invoker
set search_path = ''
as $function$
  select private.close_expired_process_impl(target_process);
$function$;
revoke all on function public.close_expired_process(uuid) from public, anon, service_role;
grant execute on function public.close_expired_process(uuid) to authenticated;

create or replace function public.create_organization(org_name text, org_slug text)
returns uuid
language sql
security invoker
set search_path = ''
as $function$
  select private.create_organization_impl(org_name, org_slug);
$function$;
revoke all on function public.create_organization(text, text) from public, anon, service_role;
grant execute on function public.create_organization(text, text) to authenticated;

create or replace function public.decide_voter_pii_access_request(target_request uuid, target_decision text, target_comment text default null::text)
returns jsonb
language sql
security invoker
set search_path = ''
as $function$
  select private.decide_voter_pii_access_request_impl(target_request, target_decision, target_comment);
$function$;
revoke all on function public.decide_voter_pii_access_request(uuid, text, text) from public, anon, service_role;
grant execute on function public.decide_voter_pii_access_request(uuid, text, text) to authenticated;

create or replace function public.emergency_suspend_process(target_process uuid, reason text, evidence jsonb default '{}'::jsonb)
returns uuid
language sql
security invoker
set search_path = ''
as $function$
  select private.emergency_suspend_process_impl(target_process, reason, evidence);
$function$;
revoke all on function public.emergency_suspend_process(uuid, text, jsonb) from public, anon, service_role;
grant execute on function public.emergency_suspend_process(uuid, text, jsonb) to authenticated;

create or replace function public.open_scheduled_process(target_process uuid)
returns uuid
language sql
security invoker
set search_path = ''
as $function$
  select private.open_scheduled_process_impl(target_process);
$function$;
revoke all on function public.open_scheduled_process(uuid) from public, anon, service_role;
grant execute on function public.open_scheduled_process(uuid) to authenticated;

create or replace function public.read_voter_register_entries(target_process uuid, target_access_mode text default 'VIEW'::text, target_limit integer default 500, target_offset integer default 0)
returns jsonb
language sql
security invoker
set search_path = ''
as $function$
  select private.read_voter_register_entries_impl(target_process, target_access_mode, target_limit, target_offset);
$function$;
revoke all on function public.read_voter_register_entries(uuid, text, integer, integer) from public, anon, service_role;
grant execute on function public.read_voter_register_entries(uuid, text, integer, integer) to authenticated;

create or replace function public.request_process_resumption(target_process uuid, reason text, review_outcome text, corrective_actions jsonb default '[]'::jsonb)
returns uuid
language sql
security invoker
set search_path = ''
as $function$
  select private.request_process_resumption_impl(target_process, reason, review_outcome, corrective_actions);
$function$;
revoke all on function public.request_process_resumption(uuid, text, text, jsonb) from public, anon, service_role;
grant execute on function public.request_process_resumption(uuid, text, text, jsonb) to authenticated;

create or replace function public.request_process_termination(target_process uuid, reason text, evidence jsonb default '{}'::jsonb)
returns uuid
language sql
security invoker
set search_path = ''
as $function$
  select private.request_process_termination_impl(target_process, reason, evidence);
$function$;
revoke all on function public.request_process_termination(uuid, text, jsonb) from public, anon, service_role;
grant execute on function public.request_process_termination(uuid, text, jsonb) to authenticated;

create or replace function public.request_voter_pii_access(target_scope text, target_event uuid, target_process uuid, target_recipient uuid, target_categories text[], target_purpose text, target_expires_at timestamp with time zone)
returns uuid
language sql
security invoker
set search_path = ''
as $function$
  select private.request_voter_pii_access_impl(target_scope, target_event, target_process, target_recipient, target_categories, target_purpose, target_expires_at);
$function$;
revoke all on function public.request_voter_pii_access(text, uuid, uuid, uuid, text[], text, timestamp with time zone) from public, anon, service_role;
grant execute on function public.request_voter_pii_access(text, uuid, uuid, uuid, text[], text, timestamp with time zone) to authenticated;

create or replace function public.revoke_event_role(target_event uuid, target_user uuid)
returns boolean
language sql
security invoker
set search_path = ''
as $function$
  select private.revoke_event_role_impl(target_event, target_user);
$function$;
revoke all on function public.revoke_event_role(uuid, uuid) from public, anon, service_role;
grant execute on function public.revoke_event_role(uuid, uuid) to authenticated;

create or replace function public.revoke_process_role(target_process uuid, target_user uuid)
returns boolean
language sql
security invoker
set search_path = ''
as $function$
  select private.revoke_process_role_impl(target_process, target_user);
$function$;
revoke all on function public.revoke_process_role(uuid, uuid) from public, anon, service_role;
grant execute on function public.revoke_process_role(uuid, uuid) to authenticated;

create or replace function public.revoke_voter_pii_access(target_request uuid, target_reason text)
returns boolean
language sql
security invoker
set search_path = ''
as $function$
  select private.revoke_voter_pii_access_impl(target_request, target_reason);
$function$;
revoke all on function public.revoke_voter_pii_access(uuid, text) from public, anon, service_role;
grant execute on function public.revoke_voter_pii_access(uuid, text) to authenticated;

create or replace function public.submit_process_for_approval(target_process uuid)
returns uuid
language sql
security invoker
set search_path = ''
as $function$
  select private.submit_process_for_approval_impl(target_process);
$function$;
revoke all on function public.submit_process_for_approval(uuid) from public, anon, service_role;
grant execute on function public.submit_process_for_approval(uuid) to authenticated;

