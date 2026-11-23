# Voting-process lifecycle and governance

Status: implementation foundation committed on the feature branch; hosted migration not applied.

## Scope

This document defines the first implemented process-lifecycle workflow. A voting event is the organizational container; each voting process is independently scheduled and governed. The process assurance tier is stored on the process and cannot be lower than its parent event's assurance tier. Raising an event's assurance tier also raises any lower child-process tiers and invalidates pending approvals through the process version timestamp.

The lifecycle implementation does not implement ballot acceptance, tallying, result certification, recounts, automatic opening/closure or public-election authorization. Those require their own domain models and assurance reviews.

## State model

| From | Operation | To | Authority |
|---|---|---|---|
| DRAFT | Submit for approval | PENDING_APPROVAL | Active OWNER, ADMIN or ELECTION_MANAGER |
| PENDING_APPROVAL | Required approvals completed | SCHEDULED | Distinct active OWNER/ADMIN approvers |
| SCHEDULED | Approved opening time reached | OPEN | Active OWNER or ADMIN invokes the scheduled-open operation |
| SCHEDULED or OPEN | Approved closing time reached | CLOSED | Active OWNER or ADMIN invokes the expired-close operation |
| OPEN | Emergency suspension | SUSPENDED | Active OWNER or ADMIN; immediate |
| SUSPENDED | Approved resumption | SCHEDULED, OPEN or CLOSED | Assurance-tier approvals |
| Non-OPEN, non-CERTIFIED, non-TERMINATED | Approved termination | TERMINATED | Assurance-tier approvals |

Scheduled opening and closing are currently manager-invoked operations; a scheduler/cron worker is not included yet. The target state after resumption is calculated from the process schedule:
- Before `opens_at`: `SCHEDULED`.
- Between `opens_at` and `closes_at`: `OPEN`.
- At or after `closes_at`: `CLOSED`.

Termination is irreversible. A replacement vote must be created as a new process. A `CERTIFIED` process is not terminated through this workflow; post-certification challenges and corrections require a separate policy.

## Approval policy

| Assurance tier | Required approvals |
|---|---:|
| STANDARD | 1 |
| ENHANCED | 2 |
| HIGH | 2 |
| CRITICAL | 3 |

- The requester cannot approve their own operation.
- Every approval must come from a distinct active organization OWNER or ADMIN.
- ELECTION_MANAGER may submit a process for approval but cannot approve it.
- If process approval is rejected, the process returns to DRAFT so its configuration can be corrected and resubmitted.
- If a pending process approval becomes stale or its opening schedule expires, the request is cancelled and the process returns to DRAFT.
- Scoped roles do not grant OWNER/ADMIN approval authority.
- Assurance tier is read from the process row; it is never accepted from the request payload.
- Process assurance cannot be lower than the parent event assurance.
- Only one PENDING workflow request may exist for a process at a time.
- Each approval or rejection is recorded in both the approval ledger and the organization audit log.
- If the process version changes while a workflow request is pending, the request is marked CANCELLED as stale.
- Approval records, lifecycle events and corresponding audit events are written within the same database transaction as the transition.

## Emergency suspension

An active OWNER or ADMIN can immediately move an OPEN process to SUSPENDED. The caller must provide a reason of 10–2000 characters. The database writes the lifecycle event and audit evidence atomically with the status change.

This operation is containment, not a finding that an allegation is proven. A documented incident review is required before resumption can be requested. The database RPC changes process status; when ballot acceptance is implemented, every ballot submission must independently require the process to be OPEN and within its schedule. No ballot acceptance endpoint exists yet, so the suspension RPC must not be represented as a complete deployed voting-stop control until that endpoint is built and tested.

## Resumption

Resumption is a separate workflow request. It requires:
- The process is SUSPENDED and has emergency-suspension evidence.
- A reason and documented review outcome.
- A corrective-actions JSON array (which may be empty if no corrective action is required).
- The required number of approvals under the process assurance tier.

The process remains SUSPENDED until all approvals are complete. The requester cannot approve their own request.

## Termination

An OPEN process must first be emergency-suspended. A termination request requires a reason and evidence, then the assurance-tier approval threshold. CERTIFIED and already TERMINATED processes are rejected.

Termination is not deletion. The process, configuration, voter-register evidence, ballots, approvals, audit records and reports must be retained under the applicable retention and privacy rules. The current migration does not delete any of these records.

Public-election category creation is disabled in the first release at both the API and database constraint layers. Removing that restriction requires jurisdiction-specific legal authorization, independent security assurance and a separate product decision.

## Database objects

Migration: `supabase/migrations/20261123160000_process_lifecycle_and_payments.sql`

- `process_lifecycle_events`: append-only lifecycle evidence.
- `process_workflow_requests`: approval requests and version snapshots.
- `process_workflow_approvals`: one decision per approver per request.
- `voting_processes.assurance_tier`: process assurance tier with parent-event floor.
- `private.required_process_approvals`: central threshold mapping.
- `public.submit_process_for_approval`
- `public.open_scheduled_process`
- `public.close_expired_process`
- `public.emergency_suspend_process`
- `public.open_scheduled_process`
- `public.close_expired_process`
- `public.request_process_resumption`
- `public.request_process_termination`
- `public.approve_process_workflow_request`

The RPCs are SECURITY DEFINER functions with an empty search path, explicit membership checks and EXECUTE granted only to authenticated users. Direct client status updates remain restricted to DRAFT configuration.

## Draft configuration APIs

All routes require an Auth0 session and active organization membership with OWNER, ADMIN or ELECTION_MANAGER authority. The Supabase RLS policies remain the final authorization boundary.

- `POST /api/organizations/{organizationId}/events`: create an event with `title`, `category`, optional `description` and `assuranceTier`. PUBLIC_ELECTION is disabled in the first release.
- `POST /api/events/{eventId}/processes`: create a process with `title`, `ballotFormat`, `eligibilityMode`, `assuranceTier`, `opensAt` and `closesAt`. The process tier is raised to at least the parent event tier.
- `POST /api/processes/{processId}/contests`: create a contest with `title`, optional `description` and `displayOrder`.
- `POST /api/contests/{contestId}/items`: create a ballot item with `itemType`, `label`, optional `description`, `displayOrder` and `metadata`.

Configuration writes are permitted only while the process is DRAFT. A process cannot be submitted until it has at least one contest containing at least one ballot item.

## HTTP contracts

### Submit a process

`POST /api/processes/{processId}/workflow`

```json
{ "action": "submit_for_approval" }
```

The process must be DRAFT, have a future opening time, a later closing time, and at least one contest containing a ballot item.

### Open a scheduled process

```json
{ "action": "open_scheduled" }
```

An active OWNER or ADMIN can invoke this only after the approved `opens_at` time and before `closes_at`.

### Close an expired process

```json
{ "action": "close_expired" }
```

An active OWNER or ADMIN can invoke this only at or after the approved `closes_at` time. Early closure is not provided by this endpoint; use emergency suspension for an urgent stop.

### Emergency suspension

```json
{
  "action": "emergency_suspend",
  "reason": "Credible incident requires voting to stop immediately.",
  "evidence": { "incidentReference": "INC-2026-001" }
}
```

### Request resumption

```json
{
  "action": "request_resumption",
  "reason": "Corrective work is complete and resumption is requested.",
  "reviewOutcome": "The incident review found the issue contained and verified the corrective work.",
  "correctiveActions": []
}
```

### Request termination

```json
{
  "action": "request_termination",
  "reason": "The process cannot safely continue.",
  "evidence": { "incidentReference": "INC-2026-001" }
}
```

### Approve or reject a request

`POST /api/process-workflow-requests/{requestId}/decision`

```json
{ "decision": "APPROVE", "comment": "Reviewed the evidence and approve." }
```

Use `REJECT` to reject. API routes require an Auth0 session; database authorization is authoritative.

## Remaining lifecycle work

1. Add a scheduler/cron worker to invoke scheduled opening and closure reliably without a manager request.
2. Add a controlled schedule-change request with assurance-tier approvals and version invalidation.
3. Add voter-register finalization, result certification and recount workflows when those domain models exist.
4. Implement ballot acceptance only after the cryptographic secrecy and verifiability protocol is independently reviewed.
5. Add scoped event/process assignments and permission resolution; this first migration continues to rely on current organization roles.
6. Add integration tests for cross-tenant access, self-approval, duplicate approvals, stale requests, concurrent approval and all assurance tiers.

## Deployment caution

The hosted Supabase project reports migration versions that do not fully match the filenames currently tracked in GitHub. Reconcile local and remote migration history before applying this migration. Do not run `supabase db push` or apply this migration to production until the history mismatch is resolved and the migration has been reviewed in a staging project.
