# Organization membership and authorization design

Status: **Proposed implementation baseline — pending product-owner review**  
Date: 2026-11-23

## 1. Purpose and scope

Define how a signed-in platform identity gains access to one or more organization workspaces, how organization roles map to capabilities, and where authorization is enforced.

This design covers organization membership, invitations, role assignment, workspace selection and authorization. It does not implement election-specific approval workflows or voter eligibility. Organization membership is not voter eligibility.

## 2. Core invariants

1. A person has one global application identity, keyed by the immutable Auth0 `sub` and mapped to `app_users.id`.
2. A person may have memberships in multiple organizations. Each membership is scoped to exactly one organization.
3. Email is a mutable contact/ invitation attribute, never the identity key or proof of membership.
4. A membership grants access only when its status is `ACTIVE`. `INVITED`, `SUSPENDED` and `REMOVED` grant no workspace access.
5. Roles and permissions are authoritative in PostgreSQL. Never accept role, organization ID, or permissions from client-controlled metadata or JWT custom claims.
6. Every organization-owned record is accessed through a verified organization scope. A client-supplied organization ID is only a selector; it is never proof of access.
7. Server-side authorization and database RLS both enforce tenant boundaries. UI hiding is not authorization.
8. Organization membership never makes a person eligible to vote automatically. Voter eligibility is a separate, process-scoped record.
9. Auditors and observers are read-only. Neither can modify registers, process configuration, ballots, results, or audit evidence.
10. Secret ballot content is never exposed through ordinary organization administration, audit, observer or support interfaces.

## 3. Initial organization roles

The database currently defines: `OWNER`, `ADMIN`, `ELECTION_MANAGER`, `AUDITOR`, `OBSERVER`, `BILLING_MANAGER`, and `MEMBER`. The matrix below is a proposed default permission profile, not yet a final product-owner approval.

| Capability | OWNER | ADMIN | ELECTION_MANAGER | AUDITOR | OBSERVER | BILLING_MANAGER | MEMBER |
|---|---:|---:|---:|---:|---:|---:|---:|
| View organization workspace | Yes | Yes | Yes | Scoped read | Scoped read | Billing view | Limited |
| Edit organization profile/settings | Yes | Yes | No | No | No | No | No |
| Invite members | Yes | Yes | No | No | No | No | No |
| Change ordinary member roles/status | Yes | Yes | No | No | No | No | No |
| Assign/remove OWNER or ADMIN | Owner-only governance flow | No | No | No | No | No | No |
| Transfer ownership | Yes, dedicated flow | No | No | No | No | No | No |
| Create/edit draft voting events/processes | Yes | Yes | Yes | No | No | No | No |
| Manage voter register before finalization | Yes | Yes | Yes | Read only if explicitly scoped | No | No | No |
| Approve own election configuration | No | No | No | No | No | No | No |
| View operational election status | Yes | Yes | Yes | Scoped read | Scoped read | No | Limited |
| Access voter-identifying data | Need-to-know, scoped | Need-to-know, scoped | Need-to-know, scoped | Explicit scope only | No | No | No |
| View ballot choices | No | No | No | No | No | No | No |
| Certify/publish high-assurance results | Separate authorized approval workflow | Separate authorized approval workflow | Cannot approve own work | Evidence review only | No | No | No |
| Manage organization billing | Yes | Optional delegated grant | No | No | No | Yes | No |
| View audit evidence | Yes | Yes | Scoped operational events | Scoped read-only | Published/observer subset | Billing events only | No |
| Export organization data | Scoped | Scoped | Process-scoped | Audit evidence only | Published subset | Billing records only | No |

### Role interpretation

- **OWNER**: ultimate organization-level control, including ownership transfer and organization closure subject to retention/legal-hold rules. Ownership transfer must be an explicit, re-authenticated workflow; never a normal role dropdown.
- **ADMIN**: day-to-day workspace and member administration. Cannot take ownership, remove the owner, bypass separation-of-duties controls or unilaterally certify high-assurance results.
- **ELECTION_MANAGER**: prepares and operates voting events/processes and voter registers within assigned scope. Cannot approve their own sensitive configuration or certify results.
- **AUDITOR**: read-only access to explicitly assigned process evidence, audit trails and permitted reports. Access to personal data is separately granted and minimized.
- **OBSERVER**: read-only access to a deliberately limited observer view and published evidence. No voter PII, hidden configuration, ballot content or write capability.
- **BILLING_MANAGER**: billing, invoices, payment methods and financial reports only. No voter register, election configuration or ballot access.
- **MEMBER**: basic workspace presence and explicitly shared material. Does not automatically receive election-management or voter privileges.

## 4. Invitations and membership lifecycle

1. An OWNER or ADMIN submits an invitation for an email address, organization, proposed role and optional expiry.
2. The platform stores a pending invitation with a cryptographically random, single-use token hash, expiry, inviter and audit event. Do not store the raw token.
3. The invitee authenticates through Auth0. The invitation is bound to the authenticated account only after the invitation acceptance policy verifies the intended address or an approved alternate verification process.
4. The membership references the internal `app_users.id`, not email.
5. Acceptance transitions `INVITED -> ACTIVE` atomically and records who accepted and when.
6. Expiry/revocation transitions an invitation to a non-authorizing state. A suspended or removed membership cannot access the workspace.
7. Role changes and membership status changes are audited. Sensitive role changes require re-authentication and may require a second approver under the assurance policy.
8. Re-inviting an existing global identity adds a new organization membership; it must not create a duplicate `app_users` identity.

## 5. Authorization architecture

### Request flow

1. Auth0 authenticates the person and establishes the Next.js server session.
2. The server validates the session and obtains the immutable Auth0 `sub`.
3. A request-scoped Supabase client forwards the verified Auth0 ID token; Supabase verifies it through Third-Party Auth.
4. `private.current_app_user_id()` maps `sub` to the internal application user.
5. The application resolves the requested organization and confirms an active membership plus the required capability.
6. The database RLS policy independently verifies organization membership/permission for the requested rows.
7. Sensitive state changes run in a transaction and append audit evidence in the same transaction where feasible.

### Enforcement requirements

- Centralize checks in server-only application services such as `requireOrganizationAccess(orgId, permission)`; do not scatter role-string checks across UI components.
- Use permission identifiers (for example `organization.members.invite`, `election.process.configure`, `voter_register.manage`, `audit.read`, `billing.manage`) as the application-facing contract.
- Map the initial fixed roles to permission sets in trusted server/database code. Keep the role-to-permission map versioned and testable.
- Keep RLS policies aligned with those permissions. For high-risk writes, prefer narrowly scoped database functions that validate actor, organization, state transition and separation-of-duties constraints.
- Never use the Supabase service-role key for ordinary user requests; it bypasses RLS.
- Return non-enumerating errors where resource existence could leak across tenants.
- Use organization ID from a route or selection only after authorization; never trust a hidden form field as an authorization decision.

## 6. Separation of duties

At minimum, the following actions require distinct preparation and approval identities for enhanced/high/critical assurance processes:

- Finalizing the voter register.
- Approving and publishing a voting process.
- Changing a live process schedule or suspending/resuming a live process.
- Authorizing result certification/publication.
- Approving recounts or corrections.

The actor who prepares a sensitive change cannot approve that same change. The exact number and roles of approvers are process/assurance-policy decisions and must be enforced server-side, not merely shown in the UI.

## 7. Workspace routing and multi-organization users

- Organization pages use an organization-scoped route (for example, `/org/[organizationSlug]/...`) or an equivalent server-resolved context.
- A user with multiple active memberships chooses a workspace; the server re-resolves membership on every request.
- Never persist a trusted active organization solely in local storage, a cookie, query parameter or client state.
- A stale/deactivated membership must lose access immediately on the next authorized request, even if the UI still displays a cached workspace selection.

## 8. Initial implementation sequence

1. Add a server-only authorization module and typed permission identifiers.
2. Add organization-scoped route/layout and an authorized organization loader.
3. Add member list with minimal profile fields, role and status.
4. Add invitation creation, acceptance, revocation and expiry.
5. Add role/status management with owner-protection and audit events.
6. Add RLS policy and cross-tenant integration tests for every read/write path.
7. Add UI navigation only after server authorization is in place.

## 9. Required security and acceptance tests

- A user with no membership cannot read an organization or any child records.
- A user with an active membership in organization A cannot read or mutate organization B.
- `INVITED`, `SUSPENDED` and `REMOVED` memberships cannot access organization data.
- A user belonging to A and B can access each only when the request explicitly selects a workspace and active membership is rechecked.
- Email changes do not change identity or transfer memberships.
- A client cannot elevate its role by changing request JSON, headers, query parameters, local storage or Auth0 profile metadata.
- ADMIN cannot remove/replace OWNER or transfer ownership.
- ELECTION_MANAGER cannot approve their own sensitive process change.
- AUDITOR and OBSERVER cannot write, and their data views do not expose ballot choices.
- BILLING_MANAGER cannot read voter registers or election records.
- MEMBER cannot invoke administrative endpoints directly.
- Every membership/role change produces an attributable audit event.
- RLS remains effective when APIs are called directly, bypassing the UI.

## 10. Open decisions before implementation

1. Whether the organization may have multiple OWNER memberships, or exactly one active OWNER at all times.
2. Whether ADMIN may manage other ADMIN memberships, or only ordinary roles.
3. Whether role assignment can be customized per voting event/process in the first release, or remains organization-wide initially.
4. Whether invitations are email-only initially and which verification rule is required when the Auth0 email is unverified.
5. Which actions require two-person approval at each assurance tier.
6. Whether custom roles are part of the first release or a later extension. The initial recommendation is fixed built-in roles mapped to permission identifiers, with custom roles deferred until real customer requirements are validated.

Until these decisions are reviewed, this document is a design proposal, not authorization to silently change production schema or permissions.
