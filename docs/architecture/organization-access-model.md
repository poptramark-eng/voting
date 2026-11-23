# Organization membership and authorization design

Status: **Proposed implementation baseline; multiple active owners, owner-only ADMIN governance, event- and process-scoped assignments limited to ELECTION_MANAGER, AUDITOR, and OBSERVER, and OWNER/ADMIN authority to manage scoped assignments accepted**  
Date: 2026-11-23

## 1. Purpose and scope

Define how a signed-in platform identity gains access to one or more organization workspaces, how organization roles map to capabilities, and where authorization is enforced.

This design covers organization membership, invitations, role assignment, workspace selection and authorization. It does not implement election-specific approval workflows or voter eligibility. Organization membership is not voter eligibility.

## 2. Core invariants

1. A person has one global application identity, keyed by the immutable Auth0 `sub` and mapped to `app_users.id`.
2. A person may have memberships in multiple organizations. Each membership is scoped to exactly one organization.
3. An organization may have multiple active OWNER memberships.
4. Every organization must retain at least one active OWNER. The last active OWNER cannot be suspended, removed, demoted or transferred away until another OWNER has been made active.
5. Only an OWNER may appoint, change or remove an ADMIN. ADMINs cannot manage other ADMINs.
6. ADMINs may manage ordinary members and operational roles, but cannot grant OWNER or ADMIN.
7. Email is a mutable contact/invitation attribute, never the identity key or proof of membership.
8. A membership grants access only when its status is `ACTIVE`. `INVITED`, `SUSPENDED` and `REMOVED` grant no workspace access.
9. Roles and permissions are authoritative in PostgreSQL. Never accept role, organization ID, or permissions from client-controlled metadata or JWT custom claims.
10. Every organization-owned record is accessed through a verified organization scope. A client-supplied organization ID is only a selector; it is never proof of access.
11. Server-side authorization and database RLS both enforce tenant boundaries. UI hiding is not authorization.
12. Organization membership never makes a person eligible to vote automatically. Voter eligibility is a separate, process-scoped record.
13. Auditors and observers are read-only. Neither can modify registers, process configuration, ballots, results, or audit evidence.
14. Secret ballot content is never exposed through ordinary organization administration, audit, observer or support interfaces.
15. Organization roles establish the maximum authority a person may exercise in the workspace. A person may receive narrower assignments at both voting-event and voting-process levels, but neither assignment can exceed or bypass their organization-level authority.
16. Process-level assignments may further restrict access within a voting event. Effective permissions are the intersection of organization-level permissions, applicable event-level assignments, and applicable process-level assignments; a narrower scope never expands a broader one.
17. Only `ELECTION_MANAGER`, `AUDITOR`, and `OBSERVER` may be assigned at voting-event or voting-process scope. `OWNER`, `ADMIN`, `BILLING_MANAGER`, and `MEMBER` remain organization-level roles and cannot be assigned at either scoped level.

## 3. Initial organization roles

The database currently defines: `OWNER`, `ADMIN`, `ELECTION_MANAGER`, `AUDITOR`, `OBSERVER`, `BILLING_MANAGER`, and `MEMBER`. The matrix below is a proposed default permission profile, not yet a final product-owner approval.

| Capability | OWNER | ADMIN | ELECTION_MANAGER | AUDITOR | OBSERVER | BILLING_MANAGER | MEMBER |
|---|---:|---:|---:|---:|---:|---:|---:|
| View organization workspace | Yes | Yes | Yes | Scoped read | Scoped read | Billing view | Limited |
| Edit organization profile/settings | Yes | Yes | No | No | No | No | No |
| Invite ordinary members and operational roles | Yes | Yes | No | No | No | No | No |
| Assign/change/remove ADMIN | Yes | No | No | No | No | No | No |
| Assign/change/remove OWNER | Yes, dedicated governance flow | No | No | No | No | No | No |
| Change ordinary member roles/status | Yes | Yes | No | No | No | No | No |
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

Organization roles are the baseline. Only `ELECTION_MANAGER`, `AUDITOR`, and `OBSERVER` may be assigned at voting-event and voting-process levels. `OWNER`, `ADMIN`, `BILLING_MANAGER`, and `MEMBER` remain organization-level roles only. The platform may grant eligible members narrower assignments at both voting-event and voting-process levels. For example, a person may be an `ELECTION_MANAGER` for one event, an `OBSERVER` for another, and have a process-specific assignment that further limits their access within an event. Event-level assignments apply only within their event. Process-level assignments apply only within their process and may narrow the event-level authority; they cannot expand it. All assignments must be explicitly recorded, bound to the correct organization and scope, time/status-aware, auditable, and checked on every request. Effective permissions are the intersection of the active organization membership permissions and all applicable scoped assignments. A user without active organization membership cannot gain access through an event or process assignment.

- **OWNER**: organization-level governance authority. An organization can have multiple active owners. Each owner can appoint another owner or ADMIN only through an explicit, re-authenticated and audited governance workflow. The last active owner cannot be removed, suspended or demoted. Organization closure remains subject to retention/legal-hold rules.
- **ADMIN**: day-to-day workspace and member administration. May manage ordinary members and operational roles only. Cannot appoint, change or remove ADMINs or OWNERs; cannot take ownership, bypass separation-of-duties controls or unilaterally certify high-assurance results.
- **ELECTION_MANAGER**: prepares and operates voting events/processes and voter registers within assigned scope. Cannot approve their own sensitive configuration or certify results.
- **AUDITOR**: read-only access to explicitly assigned process evidence, audit trails and permitted reports. Access to personal data is separately granted and minimized.
- **OBSERVER**: read-only access to a deliberately limited observer view and published evidence. No voter PII, hidden configuration, ballot content or write capability.
- **BILLING_MANAGER**: billing, invoices, payment methods and financial reports only. No voter register, election configuration or ballot access.
- **MEMBER**: basic workspace presence and explicitly shared material. Does not automatically receive election-management or voter privileges.

## 4. Invitations and membership lifecycle

1. An OWNER or ADMIN submits an invitation for an email address, organization, proposed role and optional expiry. ADMIN cannot invite or assign OWNER/ADMIN roles.
2. The platform stores a pending invitation with a cryptographically random, single-use token hash, expiry, inviter and audit event. Do not store the raw token.
3. The invitee authenticates through Auth0. The invitation may be accepted only when the authenticated Auth0 email is verified (`email_verified = true`) and exactly matches the invited email address. If the Auth0 email is unverified, require verification before acceptance; do not treat a successful login alone as email verification.
4. The membership references the internal `app_users.id`, not email.
5. Acceptance transitions `INVITED -> ACTIVE` atomically and records who accepted and when.
6. Expiry/revocation transitions an invitation to a non-authorizing state. A suspended or removed membership cannot access the workspace.
7. Role changes and membership status changes are audited. Sensitive role changes require re-authentication and may require a second approver under the assurance policy.
8. Re-inviting an existing global identity adds a new organization membership; it must not create a duplicate `app_users` identity.
9. Invitations expire after a configurable period; the initial default is seven days. Expired invitations cannot be accepted and must be reissued.
10. An invitation token is single-use. Store only a cryptographic hash of the high-entropy random token; never store the raw token. Acceptance must atomically consume the invitation and activate the membership.
11. If the authenticated account's email differs from the invited address, do not transfer or accept the invitation automatically. Require a new invitation to the verified address or an explicit secure reissue by an authorized organization member.
12. Resend is the selected transactional email delivery provider for organization invitations and invitation-related verification messages. Resend delivers messages; the application/Auth0 verification state remains authoritative for proving the invitee controls the invited address. Configure and verify a dedicated sending domain before production delivery.
13. Invitation email sends must be idempotent per invitation/send attempt, with retry-safe handling for transient provider failures and auditable delivery status. Provider delivery or click/open events do not activate membership; only the authenticated, verified, single-use acceptance flow does.

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

- Centralize checks in server-only application services such as `requireOrganizationAccess(orgId, permission)` , `requireEventAccess(orgId, eventId, permission)`, and `requireProcessAccess(orgId, eventId, processId, permission)`; do not scatter role-string checks across UI components.
- Permit only `ELECTION_MANAGER`, `AUDITOR`, and `OBSERVER` as event-level or process-level assignment roles. Reject attempts to assign `OWNER`, `ADMIN`, `BILLING_MANAGER`, or `MEMBER` at either scope.
- Resolve effective permissions as the intersection of active organization-level permissions, applicable event-level assignments, and applicable process-level assignments. The member's organization-level role must itself authorize the capabilities being exercised; a scoped assignment cannot promote a user whose organization-level role lacks those capabilities. Event- and process-scoped roles may narrow access only; they must never grant a capability absent from the user's organization-level authority. A process assignment may further restrict the applicable event assignment, never override it to add permissions.
- Validate that the event and process belong to the selected organization and parent event, the organization membership is ACTIVE, and every applicable scoped assignment is active for the requested operation. Recheck these conditions server-side and in RLS/database functions where applicable.
- Use permission identifiers (for example `organization.members.invite`, `organization.admins.manage`, `election.process.configure`, `voter_register.manage`, `audit.read`, `billing.manage`) as the application-facing contract.
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
- Event- or process-scoped assignments cannot grant access without an active organization membership.
- Event- or process-scoped assignments cannot grant permissions above the user's organization-level authority.
- A user can hold different event-scoped roles in separate events without those assignments leaking across events or organizations.
- A process-level assignment is limited to its parent event and process, and can only narrow the effective event-level permissions.
- Conflicting or missing scoped assignments fail closed; they do not fall back to broader access.
- Email changes do not change identity or transfer memberships.
- An invitation cannot be accepted unless the authenticated Auth0 email is verified and exactly matches the invited email.
- An unverified Auth0 email cannot satisfy invitation acceptance, even after successful authentication.
- An invitation addressed to a different email cannot be accepted by the current authenticated account; it must be securely reissued.
- An expired invitation cannot be accepted; the initial default expiry is seven days unless configured otherwise.
- An invitation token can be consumed only once, and only its cryptographic hash is stored.
- Resend delivery, retries, opens or clicks do not activate a membership; acceptance must pass the application authorization checks.
- A client cannot elevate its role by changing request JSON, headers, query parameters, local storage or Auth0 profile metadata.
- ADMIN cannot assign/remove OWNER or ADMIN, cannot invite ADMIN, and cannot remove/demote an owner or another ADMIN.
- OWNER can appoint/change/remove ADMIN through the audited governance workflow.
- The system permits multiple active OWNER memberships.
- The last active OWNER cannot be suspended, removed, demoted or transferred away.
- ELECTION_MANAGER cannot approve their own sensitive process change.
- AUDITOR and OBSERVER cannot write, and their data views do not expose ballot choices.
- BILLING_MANAGER cannot read voter registers or election records.
- MEMBER cannot invoke administrative endpoints directly.
- Every membership/role change produces an attributable audit event.
- RLS remains effective when APIs are called directly, bypassing the UI.

## 10. Accepted scoped-role assignment governance

- Both active `OWNER` and `ADMIN` members may assign, change and revoke event- and process-scoped roles.
- They may assign only `ELECTION_MANAGER`, `AUDITOR`, and `OBSERVER` at those scopes.
- `ADMIN` cannot assign, change or revoke organization-level `OWNER` or `ADMIN` memberships. Only `OWNER` may appoint, change or remove an `ADMIN`, through the organization-level governance workflow.
- Scoped-role assignment authority is itself subordinate to the actor's active organization membership and the selected organization's authority. An event assignment must belong to that organization and event; a process assignment must belong to that organization and its parent event.
- Every scoped-role assignment, change and revocation must be audited with the actor, affected member, role, organization, event/process scope, action and timestamp. Record the before/after state where applicable.
- Assignment and revocation operations must be atomic with their audit record. Reject invalid role/scope combinations and inactive memberships; fail closed when scope ownership or authorization cannot be established.
- These assignment-management rights do not give an assignee permissions beyond their own organization-level authority. Process-level assignments can only narrow applicable event-level permissions.

## 11. Scoped-role permission matrix

The following is the accepted default permission profile for event- and process-scoped assignments. A permission is available only within the exact assigned event or process, while the actor and assignee both retain active organization membership. These roles do not create organization-wide permissions.

| Capability within assigned scope | ELECTION_MANAGER | AUDITOR | OBSERVER |
|---|---:|---:|---:|
| View event/process overview and operational status | Yes | Yes | Published/approved view only |
| View configuration and configuration history | Yes | Read-only evidence view | Published configuration summary only |
| Create or edit draft process configuration | Yes | No | No |
| Manage contest/ballot structure while process is draft | Yes | No | No |
| Manage voter-register entries before register finalization | Yes | No | No |
| View voter-register entries or voter-identifying data | Only when separately authorized and necessary for assigned duties | Only through a separate, explicit, minimized audit-data grant | No |
| View register counts and aggregate participation statistics | Yes | Yes | Published aggregates only |
| Submit a process for approval | Yes, where the workflow permits | No | No |
| Approve own configuration or own prepared changes | No | No | No |
| View audit trail and operational evidence | Own/assigned-scope operational evidence | Full permitted audit evidence within assigned scope, read-only | Published or observer-safe evidence only |
| View results | Authorized operational summaries; no ballot choices | Results and supporting evidence, subject to assurance policy | Published results only |
| View individual ballot selections or link a voter to a choice | No | No | No |
| Open, close, suspend, resume, certify or publish a process | No, unless a separate approved operational capability is explicitly introduced by a later policy | No | No |
| Modify audit evidence, results or finalized voter register | No | No | No |
| Export data | Operational, non-secret data needed for assigned work; PII requires separate authorization | Audit evidence and permitted reports; PII requires separate authorization | Published/observer-safe material only |

### Scope and inheritance rules

1. An event-level assignment applies to that event and its child processes, subject to any narrower process-level assignment. It never applies to another event or organization.
2. A process-level assignment applies only to that process and must reference its actual parent event and organization.
3. When a process-level assignment exists for a member and process, effective process permissions are the intersection of the organization-level permission ceiling, the applicable event-level permission set (if one exists), and the process-level permission set. A process assignment therefore cannot add a capability excluded by an event-level assignment. If no event-level assignment exists, the process assignment is still bounded by the organization-level permission ceiling.
4. Where multiple applicable assignments produce conflicting or ambiguous permissions, deny the disputed capability until an authorized administrator resolves the assignments. Do not select the more permissive role.
5. No scoped role may grant ballot-choice access, self-approval, or authority to certify/publish results. Those capabilities, if ever introduced, require a separate assurance and separation-of-duties design.
6. Voter-identifying data is not implied by an ELECTION_MANAGER or AUDITOR assignment. It requires a separate, purpose-limited authorization, and must be excluded from observer access.
7. These defaults intentionally keep process lifecycle transitions and final approvals outside the three scoped roles. Any later need for opening/closing/suspending processes must be separately designed, approved and audited rather than inferred from the ELECTION_MANAGER role.

## 12. Voter-identifying data authorization

Voter-identifying data is protected separately from event- and process-scoped roles. Neither an ELECTION_MANAGER nor an AUDITOR assignment grants access to personally identifying voter data by itself. OBSERVER is never eligible for this access.

- An active OWNER or ADMIN may grant a separate, purpose-specific authorization to an active ELECTION_MANAGER or AUDITOR whose existing event/process assignment covers the relevant data scope.
- Each grant must identify the organization, event, process (where applicable), recipient, permitted data categories, stated operational or audit purpose, granting actor, creation time and expiry time.
- Grants must be time-limited and expire automatically. The granting actor must choose an expiry; indefinite grants are prohibited. The platform should support early revocation by an authorized OWNER or ADMIN.
- Access is limited to the minimum data categories and operations required for the stated purpose. A grant cannot provide ballot-choice access, voter-to-ballot linkage, or permissions outside the recipient's existing event/process assignment.
- Every grant, access-sensitive change, expiry and revocation must produce attributable audit evidence. Grant creation, modification and revocation must be atomic with their audit records where feasible.
- The authorization must be checked on every relevant read/export, server-side and through database/RLS enforcement where applicable. Missing, expired, revoked, mismatched-scope or ambiguous grants fail closed.
- Data exports must apply the same scope, purpose and expiry restrictions as on-screen access. Export events should be separately audited.
- OWNER/ADMIN approval of a grant does not override applicable privacy law, data minimization, retention rules or higher-assurance separation-of-duties controls.

### Assurance-tiered approval for voter-identifying data grants

The approval threshold is determined by the assurance tier of the voting process covered by the grant:

- **STANDARD:** one approval from an active OWNER or ADMIN is required.
- **ENHANCED, HIGH, and CRITICAL:** two approvals from two distinct active users, each holding an OWNER or ADMIN role in the organization, are required before the grant becomes active.
- The requester may request access for themselves or another eligible recipient, but the requester cannot approve that request. No person may supply more than one of the required approvals.
- For tiers requiring two approvals, one approval is insufficient to activate the grant. If either authorized approver rejects the request, the request is denied and no grant becomes active.
- The approval record must capture the approver, decision, timestamp, assurance tier, exact scope, purpose, permitted data categories, and requested expiry. The grant becomes active only after the required approvals have been recorded and all grant eligibility checks pass.
- Request, approval, rejection, activation, expiry and revocation events must be auditable. Approval and grant activation must be atomic with their audit evidence where feasible.
- Any change to the requested organization/event/process scope, purpose, permitted data categories or expiry after approval invalidates the existing approvals; the changed request must pass the applicable approval threshold again.
- The assurance tier used to determine the threshold must be resolved from the process being accessed, not supplied by the requester. If the grant covers multiple processes with different assurance tiers, apply the highest applicable approval threshold.
- An OWNER or ADMIN who is the requester cannot approve their own request, even if they otherwise have grant authority.


### Grant lifetime and re-authorization cadence

The maximum lifetime of a voter-identifying data grant is determined by the highest assurance tier among the processes covered by the grant:

| Assurance tier | Maximum grant lifetime |
|---|---:|
| STANDARD | 30 days |
| ENHANCED | 7 days |
| HIGH | 24 hours |
| CRITICAL | 4 hours |

- These periods are maximum validity windows, not automatic renewal intervals. A grant may be issued for a shorter period when the stated purpose requires less time.
- A grant expires automatically at its recorded expiry. Renewal requires a new request and fresh approvals under the threshold applicable at renewal; grants never renew silently or automatically.
- If a grant covers multiple processes with different assurance tiers, use the highest tier to determine both its maximum lifetime and approval threshold.
- If a process's assurance tier increases while a grant is active, immediately apply the shorter maximum lifetime. Re-evaluate the approval threshold against the new tier; suspend access until any newly required approvals have been obtained. A tier decrease does not extend an existing grant or relax its already-required approvals.
- An OWNER or ADMIN may revoke a grant before expiry. Revocation takes effect immediately for subsequent reads and exports.

## 13. Assurance-tiered approval for sensitive voting operations

The following approval matrix is the accepted default for sensitive operations. The required count is the number of distinct approvers, determined by the assurance tier of the voting process.

| Sensitive action | STANDARD | ENHANCED | HIGH | CRITICAL |
|---|---:|---:|---:|---:|
| Finalize voter register | 1 | 2 | 2 | 3 |
| Approve a voting process | 1 | 2 | 2 | 3 |
| Change an approved schedule | 1 | 2 | 2 | 3 |
| Certify results | 1 | 2 | 2 | 3 |
| Authorize a recount | 1 | 2 | 2 | 3 |

### Mandatory approval safeguards

1. The person who initiates or submits an operation cannot approve that same operation, at any assurance tier.
2. Every required approval must come from a different person. No individual may satisfy more than one approval slot.
3. Approvers must be active OWNER or ADMIN members of the organization. Scoped ELECTION_MANAGER, AUDITOR and OBSERVER assignments do not independently confer approval authority.
4. Approvals are bound to the exact operation, scope and version/snapshot being reviewed. Any material change to the operation, including its relevant configuration or schedule, invalidates all prior approvals and requires the threshold to be met again.
5. An operation remains pending and must not take effect until all required approvals are recorded and eligibility checks pass. A rejection prevents activation and requires a new submission after the issue is addressed.
6. Record the initiator, each approver and decision, timestamps, assurance tier, exact scope, operation/version and relevant approved details in an auditable record. Approval and state transition must be atomic with audit evidence where feasible.
7. For result certification, approvers must also be independent of the people who prepared the results being certified. Result preparation and certification must remain separate duties.
8. The assurance tier is resolved from the voting process being acted upon, never supplied by the requester. If an operation spans multiple processes, apply the highest applicable tier and threshold.

These controls are the default approval policy for the listed operations. They do not grant lifecycle-transition permissions to scoped roles or override the separate voter-identifying-data grant policy in Section 12. Emergency suspension and other unlisted actions require their own explicit policy rather than an inferred exception.

## 14. Open decisions before implementation

1. Whether custom roles are part of the first release or a later extension. The initial recommendation is fixed built-in roles mapped to permission identifiers, with custom roles deferred until real customer requirements are validated.

The multiple-active-OWNER, owner-only ADMIN governance, event- and process-scoped assignment levels, restriction of scoped roles to `ELECTION_MANAGER`, `AUDITOR`, and `OBSERVER`, OWNER/ADMIN authority to manage those scoped assignments, the default scoped-role permission matrix in Section 11, the separate, purpose-specific, time-limited voter-identifying data authorization in Section 12, the assurance-tiered approval thresholds, and the tier-based maximum grant lifetimes and re-authorization rules in Section 12, the verified-email invitation acceptance policy, seven-day default invitation expiry, single-use hashed invitation tokens, and Resend as the transactional invitation email provider in Section 4, and the assurance-tiered approval matrix and safeguards for sensitive operations in Section 13 are accepted. `OWNER`, `ADMIN`, `BILLING_MANAGER`, and `MEMBER` remain organization-level roles only. Scoped assignments are subordinate to organization-level authority; process-level assignments can further narrow event-level access. The remaining details and the rest of this document remain a design proposal, not authorization to silently change production schema or permissions.
