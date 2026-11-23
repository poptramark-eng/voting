# Architecture direction

Status: modular-monolith decision accepted; detailed domain design in progress.

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
- Application: TypeScript, Next.js App Router as the recommended initial web and server runtime.
- Database: PostgreSQL on Supabase as the system of record.
- Identity: Auth0 for authentication and federation; application database remains authoritative for membership and permissions.
- Hosting: Vercel for the Next.js application and bounded request handlers.
- Cache: Redis is deferred until a measured need exists. It is not authoritative storage.
- Background work: PostgreSQL transactional outbox first; add a queue/worker only when justified.
- Auth0/Supabase identity mapping is implemented in migration `20261123160000_auth0_identity_mapping.sql`. Provider-side configuration and first-login provisioning remain to be completed.

## Delivery sequence

- Foundation: repository standards, domain model, tenancy, identity mapping, access-control tests, migrations and CI.
- Core voting: process configuration, voter register, eligibility, ballot lifecycle and deterministic tallying.
- Assurance: independent protocol review, audit evidence, verification and dispute workflows.
- Operations: notifications, payment adapters, reporting, backups, monitoring and recovery.
- Expansion: mobile, offline, deeper integrations, dedicated tenancy and self-hosted operations.

## Architecture decisions still open

- Final framework/package versions and application folder structure.
- Auth0 tenant configuration, Supabase third-party provider setup and identity sync implementation.
- Transactional outbox schema and worker execution model.
- End-to-end verifiable voting protocol and cryptographic key management.
- Tenant isolation strategy refinements and authorization test matrix.
- Kenya legal, regulatory and privacy review.
