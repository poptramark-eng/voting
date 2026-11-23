# Architecture direction

Status: modular-monolith decision accepted; identity boundary defined; implementation foundation in progress.

## Core boundaries

1. Identity and access: global identity, federation, sessions, MFA and account recovery.
2. Organization tenancy: organizations, memberships, scoped roles, approval workflows and tenant isolation.
3. Election management: events, processes, contests, options, schedules and lifecycle transitions.
4. Voter registration and eligibility: register imports, eligibility evidence, finalization and eligibility credentials.
5. Ballot box: ballot acceptance, encrypted ballot payloads, replacement semantics and verifiability.
6. Tally and results: deterministic counting, tie-breaking, result stages and publication policies.
7. Payments and billing: platform subscription billing, participation payments, provider adapters, settlement and refunds.
8. Notifications: templates, delivery, retries and preferences.
9. Audit and assurance: append-only events, signed evidence, checkpoints, observer access and dispute records.
10. Reporting and integrations: scoped exports, APIs, webhooks and external identity/payment/communications adapters.

## Critical trust boundaries

- Never store a direct voter identity-to-choice mapping in the ballot box.
- Keep eligibility issuance/redemption records separate from encrypted ballot records.
- Do not use payment status as proof that a ballot was cast.
- Do not let analytics or support tooling reconstruct secret choices.
- Tenant authorization must be enforced server-side and at the database boundary where applicable.
- Privileged operations require scoped authorization, separation of duties and auditable approval.
- Hash-chained logs are tamper-evident evidence, not proof of ballot correctness or coercion resistance.

## Adopted implementation direction

- Architecture: modular monolith with explicit domain modules; see [ADR 0001](adr/0001-modular-monolith.md).
- Application: TypeScript, Next.js App Router (Next.js 16) as the initial web and server runtime.
- Identity SDK: official Auth0 Next.js SDK v4, using the Next.js 16 `proxy.ts` convention.
- Identity provider: Auth0. See [ADR 0002](adr/0002-auth0-supabase-identity.md).
- Authorization: PostgreSQL is authoritative for application users, organization memberships, scoped roles and permissions. Auth0 authenticates; it does not grant tenant roles.
- Database: PostgreSQL on Supabase as the system of record.
- Auth0-to-database mapping: immutable Auth0 `sub` maps to internal `app_users.id`; RLS resolves the internal identity with `private.current_app_user_id()`.
- Supabase access: Supabase Third-Party Auth trusts the Auth0 tenant; the Auth0 ID token carries `role: authenticated` for Postgres role selection.
- Hosting: Vercel for the Next.js application and bounded request handlers.
- Auth0/Vercel integration: standard Auth0 tenant/application configuration stored in Vercel environment variables. Do not use the Vercel-native Auth0 integration by default because it provisions a new tenant/application.
- Cache: Redis is deferred until a measured need exists. It is not authoritative storage.
- Background work: PostgreSQL transactional outbox first; add a queue/worker only when justified.
- Identity database migrations are tracked in `supabase/migrations/`; verify hosted migration history before applying new migrations. The hosted project and repository currently have a migration-version naming mismatch that must be reconciled before deployment.

## Delivery sequence

- Foundation: repository standards, domain model, tenancy, identity mapping, access-control tests, migrations and CI.
- Authentication: provision Auth0 tenant/app, configure Supabase Third-Party Auth and ID-token claim, then implement server-validated session-to-database access.
- Organization access: accepted first-release built-in roles, membership governance, scoped assignments and tenant-isolation tests. See [organization access model](organization-access-model.md).
- Voter-identifying data: purpose-bound, time-limited grants for ELECTION_MANAGER/AUDITOR with assurance-tiered OWNER/ADMIN approvals, field-level minimization and audited reads/exports. See [voter PII access](../security/voter-pii-access.md).
- Process governance: initial lifecycle approval, emergency suspension, resumption and termination RPC/API foundation. See [process lifecycle](process-lifecycle.md). Schedule changes, automated opening/closure scheduling, voter-register finalization, recounts and result certification remain future work; scheduled opening/closure can currently be invoked by an authorized manager.
- Core voting: process configuration, voter register, eligibility, ballot acceptance, cryptographic secrecy protocol and deterministic tallying. The voter PII grant and audited read/export foundation is implemented on the feature branch; a dedicated management UI and staging database tests remain. Ballot acceptance must not be implemented until the secrecy and verifiability protocol is independently reviewed.
- Assurance: independent protocol review, audit evidence, verification and dispute workflows.
- Operations and billing: Paystack organization-billing checkout and webhook foundation. Subscription entitlement provisioning, refunds, settlement reconciliation, reports, backups, monitoring and recovery remain future work. See [Paystack integration](../payments/paystack-integration.md).
- Expansion: mobile, offline, deeper integrations, dedicated tenancy and self-hosted operations.

## Architecture decisions still open

- Final framework/package versions and application folder structure.
- Transactional outbox schema and worker execution model.
- End-to-end verifiable voting protocol and cryptographic key management.
- Tenant isolation strategy refinements and authorization test matrix.
- Kenya legal, regulatory and privacy review.
