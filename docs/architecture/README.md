# Architecture direction

Status: initial architecture hypothesis; not yet an approved detailed design.

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

## Provisional technology direction

The user has requested GitHub implementation and a Supabase database. A reasonable starting direction is PostgreSQL as the system of record, TypeScript for application services, a web client and provider adapters. Supabase is under evaluation as the managed PostgreSQL platform. No application framework, authentication vendor, queue, cache or deployment platform has yet been formally selected for this repository.

## Delivery sequence

- Foundation: repository standards, domain model, tenancy, access-control tests, migrations and CI.
- Core voting: process configuration, voter register, eligibility, ballot lifecycle and deterministic tallying.
- Assurance: independent protocol review, audit evidence, verification and dispute workflows.
- Operations: notifications, payment adapters, reporting, backups, monitoring and recovery.
- Expansion: mobile, offline, deeper integrations, dedicated tenancy and self-hosted operations.

## Architecture decisions still open

- Modular monolith versus distributed services at launch.
- Exact application framework and deployment topology.
- Identity provider and federation strategy.
- Queue/cache selection and transactional outbox design.
- End-to-end verifiable voting protocol and cryptographic key management.
- Tenant isolation strategy and Supabase role/RLS model.
- Database schema after domain and threat-model review.
