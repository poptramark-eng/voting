-- Add covering indexes for the remaining public foreign keys identified by the
-- staging Performance Advisor. These support joins and parent-key update/delete checks.

create index if not exists event_role_assignments_assigned_by_idx
  on public.event_role_assignments(assigned_by);
create index if not exists event_role_assignments_user_idx
  on public.event_role_assignments(user_id);

create index if not exists payment_transactions_initiated_by_idx
  on public.payment_transactions(initiated_by);

create index if not exists process_lifecycle_events_actor_idx
  on public.process_lifecycle_events(actor_user_id);
create index if not exists process_lifecycle_events_workflow_request_idx
  on public.process_lifecycle_events(workflow_request_id);

create index if not exists process_role_assignments_assigned_by_idx
  on public.process_role_assignments(assigned_by);
create index if not exists process_role_assignments_event_idx
  on public.process_role_assignments(event_id);
create index if not exists process_role_assignments_organization_idx
  on public.process_role_assignments(organization_id);
create index if not exists process_role_assignments_user_idx
  on public.process_role_assignments(user_id);

create index if not exists process_workflow_approvals_approver_idx
  on public.process_workflow_approvals(approver_user_id);
create index if not exists process_workflow_requests_requested_by_idx
  on public.process_workflow_requests(requested_by);

create index if not exists voter_pii_access_approvals_approver_idx
  on public.voter_pii_access_approvals(approver_user_id);

create index if not exists voter_pii_access_requests_process_idx
  on public.voter_pii_access_requests(process_id);
create index if not exists voter_pii_access_requests_requested_by_idx
  on public.voter_pii_access_requests(requested_by);
create index if not exists voter_pii_access_requests_revoked_by_idx
  on public.voter_pii_access_requests(revoked_by);

-- Make the Auth0 JWT evaluation an explicit init plan in app_users RLS policies.
drop policy if exists "users can provision their own application identity" on public.app_users;
create policy "users can provision their own application identity"
on public.app_users for insert to authenticated
with check (
  auth_subject = ((select auth.jwt()) ->> 'sub')
  and email is not distinct from nullif(((select auth.jwt()) ->> 'email'), '')
  and display_name is not distinct from nullif(((select auth.jwt()) ->> 'name'), '')
);

drop policy if exists "users can read their own application identity" on public.app_users;
create policy "users can read their own application identity"
on public.app_users for select to authenticated
using (auth_subject = ((select auth.jwt()) ->> 'sub'));

drop policy if exists "users can sync their own application identity" on public.app_users;
create policy "users can sync their own application identity"
on public.app_users for update to authenticated
using (auth_subject = ((select auth.jwt()) ->> 'sub'))
with check (
  auth_subject = ((select auth.jwt()) ->> 'sub')
  and email is not distinct from nullif(((select auth.jwt()) ->> 'email'), '')
  and display_name is not distinct from nullif(((select auth.jwt()) ->> 'name'), '')
);
