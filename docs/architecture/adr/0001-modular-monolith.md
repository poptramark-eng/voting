# ADR 0001: Modular monolith for the first release

- Status: Accepted
- Date: 2026-11-23

## Context

The product needs enterprise-grade security and reliability but is being built by a small team with strict cost constraints. Its domains are strongly related and will evolve rapidly while requirements, assurance tiers and operational controls are validated.

## Decision

Start with one deployable TypeScript application using a modular monolith. Keep domain modules internally separated and communicate through explicit application-service interfaces and domain events. PostgreSQL/Supabase is the durable system of record.

Initial modules:
- Identity and access
- Organizations and memberships
- Voting events and process configuration
- Voter registers and eligibility
- Ballot protocol boundary (not yet implemented)
- Tally and result publication
- Payments and billing
- Notifications
- Audit, assurance and disputes
- Reporting and integrations

Use a transactional outbox for reliable post-commit work. Begin with a PostgreSQL-backed outbox and a small worker/scheduled processor; do not introduce Kafka or a distributed queue before throughput or isolation requirements justify it.

## Redis policy

Redis is optional infrastructure, not a system of record. Add a managed Redis-compatible service only when measurements or an explicit threat-control requirement justify it. Initial candidates are short-lived cache entries, distributed rate limits, request coalescing and ephemeral coordination. Redis must not be the authoritative store for ballots, eligibility, payment state, idempotency guarantees, audit evidence or election lifecycle state.

All Redis access must use pooled or multiplexed connections, explicit timeouts and bounded key TTLs. Treat cache loss as a normal recoverable condition. Never make correctness depend on cache contents.

## Deployment

Deploy the web application and its request handlers on Vercel Functions initially. Keep background work idempotent and bounded. Move a worker to a separately deployed service only when execution duration, throughput, connection lifetime or independent scaling requires it.

## Consequences

Positive:
- Lower operational cost and simpler deployment.
- Easier local development and end-to-end testing.
- Clear module boundaries preserve future extraction options.
- PostgreSQL transactions remain available for core state changes.

Trade-offs:
- Requires disciplined module boundaries to avoid a monolith becoming tangled.
- Background jobs need durable outbox semantics and retry handling.
- A single deployment may couple release cycles until modules need independent scaling.

## Extraction criteria

Extract a module into a separate service only when at least one is demonstrated:
- Independent scaling or availability needs cannot be met economically in the monolith.
- A security boundary requires separate credentials, network policy or deployment ownership.
- Workload/runtime constraints require a different execution environment.
- A stable domain contract exists and the operational cost is justified.
