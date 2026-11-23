# Voter-identifying data access grants

Status: implementation foundation committed to `feat/lifecycle-paystack-foundation`; migration not applied to the hosted database.

## Security boundary

A scoped `ELECTION_MANAGER` or `AUDITOR` assignment does not itself authorize access to voter-identifying register fields. `OBSERVER` is never eligible. An additional purpose-bound, time-limited grant is required.

The first implementation grants read/export access only. Existing voter-register insert/update permissions remain OWNER/ADMIN-only and are limited to DRAFT processes by RLS.

Authenticated clients cannot SELECT directly from `public.voter_register_entries`. The SELECT privilege is revoked. All authenticated reads and exports must use the audited `read_voter_register_entries` RPC through the application API. The RPC checks organization authority or an active grant, applies field-level minimization, writes an audit event in the same database transaction, and returns only the permitted fields. The service-role key is never used by these user-facing routes.

## Scope and data categories

Requests are either:
- `EVENT`: applies across processes in one event, but each process is still checked against the recipient's effective event/process role and assurance tier.
- `PROCESS`: applies to one named process only.

A process-level assignment can narrow event-level access and cannot expand it. If a process has an override role that lacks `voter_pii.read`, access is denied for that process even if an event-level grant exists.

The requester selects one or more exact categories:

| Category | Register field |
|---|---|
| `VOTER_NAME` | `display_name` |
| `CONTACT_EMAIL` | `contact_email` |
| `CONTACT_PHONE` | `contact_phone` |
| `EXTERNAL_REFERENCE` | `external_reference` |

The register row ID, eligibility status, source and timestamps are included as operational metadata. Fields outside the approved categories are omitted from the returned JSON and CSV. No grant exposes ballot choices, ballot identifiers, vote contents or a voter-to-ballot relationship.

## Who may request and receive access

- The recipient must be an active organization member with an active `ELECTION_MANAGER` or `AUDITOR` assignment covering the requested event/process.
- `OBSERVER`, ordinary `MEMBER`, `BILLING_MANAGER`, and organization-only `OWNER`/`ADMIN` assignments are not eligible recipients through this grant workflow.
- An eligible recipient may request access for themselves.
- An active organization OWNER or ADMIN may request access for another eligible recipient.
- Only active organization OWNER or ADMIN members may approve, reject or revoke grants.
- The requester cannot approve or reject their own request. Every approval is from a distinct person; a unique database constraint enforces one decision per approver per request. At final activation, previously approving users are rechecked and must still be active OWNER/ADMIN members; otherwise the request becomes stale and must be resubmitted.

## Assurance approvals and maximum lifetime

The process assurance tier is resolved from the database, never accepted from the client. An event-scope request uses the highest assurance tier among the event's processes; if the event has no processes yet, it uses the event tier.

| Assurance tier | Required approvals | Maximum grant lifetime |
|---|---:|---:|
| STANDARD | 1 | 30 days |
| ENHANCED | 2 | 7 days |
| HIGH | 2 | 24 hours |
| CRITICAL | 3 | 4 hours |

The requested expiry must be in the future and within the tier maximum. These are maximum windows, not default durations. A shorter expiry may be requested.

- One approval does not activate a two- or three-approval request.
- Any authorized approver rejection immediately rejects the request.
- The grant activates only after the required distinct approvals.
- Approvals store a snapshot of scope, recipient, categories, purpose, tier and requested expiry.
- Request details cannot be edited after submission. To change scope, purpose, categories or expiry, revoke/cancel the old request and create a new request with fresh approvals.
- Renewal is a new request with fresh approvals; no automatic or silent renewal is allowed.
- A process/event assurance-tier increase makes an existing grant fail closed for any scope whose current tier exceeds the approved tier. Pending requests become stale if the tier changes before approval completes. A new request and fresh approvals are required.
- A decrease in assurance tier does not extend an existing grant or relax the approvals already obtained.
- Expiry is enforced in the database on every read. The request row may retain status `ACTIVE` after its timestamp passes; API responses expose the computed `effectiveStatus: EXPIRED`.

Overlapping pending or unexpired active grants for the same recipient/event are rejected. A request cannot create a second grant that overlaps an existing event- or process-scope grant.

## Revocation and audit

An active OWNER or ADMIN can revoke a pending or active request early with a reason. Membership suspension/removal, role-assignment revocation/expiry, grant expiry, or an assurance-tier increase independently makes the access check fail closed.

The database records:
- request creation and exact purpose/scope/categories/tier/expiry;
- each distinct approval or rejection and its immutable request snapshot;
- grant activation, rejection, staleness and revocation;
- every voter-register view and export, including actor, process, grant ID (if any), purpose, categories, row count, page offset/limit and access mode.

Audit events record metadata only; they do not copy voter-identifying fields.

## API contracts

All routes require an Auth0 session. Postgres RPC checks and RLS remain authoritative.

### Create a request

`POST /api/voter-pii-access-requests`

```json
{
  "scope": "PROCESS",
  "eventId": "event-uuid",
  "processId": "process-uuid",
  "recipientUserId": "app-user-uuid",
  "categories": ["VOTER_NAME", "CONTACT_EMAIL"],
  "purpose": "Contact registered voters to resolve duplicate eligibility records before register finalization.",
  "expiresAt": "2026-11-25T10:00:00.000Z"
}
```

For event scope, set `scope: "EVENT"` and omit `processId`.

### List and inspect requests

- `GET /api/voter-pii-access-requests?eventId={eventId}`
- `GET /api/voter-pii-access-requests?processId={processId}`
- `GET /api/voter-pii-access-requests/{requestId}` returns the request and approval history.

RLS limits visibility to active organization OWNER/ADMIN members, the requester and the recipient; approvers are active OWNER/ADMIN members.

### Approve or reject

`POST /api/voter-pii-access-requests/{requestId}/decision`

```json
{ "decision": "APPROVE", "comment": "Reviewed the stated purpose and data minimization." }
```

Use `REJECT` to reject. A request remains pending until the tier threshold is met.

### Revoke

`POST /api/voter-pii-access-requests/{requestId}/revoke`

```json
{ "reason": "The operational need has ended." }
```

Only active OWNER/ADMIN members may revoke.

### Read and export the register

- `GET /api/processes/{processId}/voter-register?limit=500&offset=0` returns paginated, category-filtered JSON.
- `POST /api/processes/{processId}/voter-register` with `{"limit":5000,"offset":0}` returns a CSV attachment. Each export is separately audited. CSV formula-leading cells are escaped.

Page size is limited to 5,000. The JSON response includes `hasMore`; the CSV response includes `X-Has-More`. Clients must paginate larger registers. Responses are marked `Cache-Control: no-store`.

## Database objects

Migration: `supabase/migrations/20261123200600_voter_pii_access_grants.sql`

- `voter_pii_access_requests`: immutable request details and grant state.
- `voter_pii_access_approvals`: distinct approval/rejection ledger with request snapshot.
- `private.user_has_event_pii_role` and `private.user_has_process_permission`: recipient eligibility checks.
- `private.resolve_voter_pii_assurance`, `private.required_voter_pii_approvals`, `private.max_voter_pii_grant_lifetime`: database policy helpers.
- `private.active_voter_pii_grant` and `private.has_active_voter_pii_grant`: fail-closed grant evaluation.
- `public.request_voter_pii_access`, `public.decide_voter_pii_access_request`, `public.revoke_voter_pii_access`.
- `public.read_voter_register_entries`: audited, paginated, field-filtered register access and export.

All public SECURITY DEFINER RPCs pin an empty search path, validate the Auth0-mapped application identity and have EXECUTE revoked from PUBLIC/anon, with explicit EXECUTE granted to authenticated. Private helpers are not exposed to authenticated clients except the boolean helper required by the RLS policy. The voter-register table retains RLS; authenticated direct SELECT is revoked so reads cannot bypass the audited RPC.

## Implementation limitations and next work

- The current increment provides database, API and CSV-export foundations; a dedicated management UI is still required.
- The request API and list/detail APIs are available, but no notification/email workflow is wired to approvals yet.
- Integration tests against a staging database are required for RLS, concurrent approval, expiry, role revocation, tier escalation, event/process overlap and CSV export.
- The migration has not been applied to the hosted Supabase project. Reconcile migration history first, then apply and test on staging before production.
- Applicable Kenyan data-protection law, customer contracts, data minimization, retention and incident response must be reviewed before production use.
