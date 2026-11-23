# Deployment, background work and cache policy

- Status: Recommended architecture; Vercel project linkage pending
- Date: 2026-11-23

## Vercel

Use Vercel for the Next.js web application and request/response handlers. Keep the first release in one Vercel project linked to `poptramark-eng/voting`. Use preview deployments for pull requests and production deployments from the protected main branch.

The Vercel account connector currently returns no teams and no Git-linked project context. The project has therefore not been created or deployed. The Vercel project creation tool requires an explicit team ID; do not guess one or create a project under an unintended account. Once the correct Vercel team/account is available, link the repository and configure environment variables separately for development, preview and production.

Expected server-only environment variables (names are a planning list, not populated values):
- `AUTH0_DOMAIN`
- `AUTH0_CLIENT_ID`
- `AUTH0_CLIENT_SECRET`
- `AUTH0_SECRET`
- `APP_BASE_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (server-only; never expose to client bundles)

Keep local secrets in ignored environment files and managed secrets in Vercel. Never commit credentials.

## Background processing

Use a transactional outbox in PostgreSQL for events that must be delivered after a database transaction commits (notifications, webhook delivery, payment follow-up and audit export jobs). Workers must be idempotent, retry with backoff, record attempts and dead-letter permanently failing work. Do not use an in-memory queue as the durable source of truth.

Vercel Functions are suitable for bounded request handlers and webhook receivers. Durable multi-step workflows or sustained workers may later use a dedicated worker or managed queue after product and cost validation.

## Redis

Redis is not required for the initial schema foundation. Add it only for measured or explicit needs:
- Distributed rate limiting and abuse controls.
- Short-lived caching of non-sensitive, non-authoritative reference data.
- Request coalescing and ephemeral coordination.
- Temporary state with explicit TTL and recovery behavior.

Never store ballots, voter-choice links, authoritative eligibility, payment balances, election state, idempotency records required for correctness, or audit evidence as Redis-only data.

Use a managed Redis-compatible service with TLS, authentication, private/limited network access where available, bounded TTLs, key namespacing, connection pooling/multiplexing, explicit timeouts and monitoring. Do not use `KEYS` or unbounded collection reads in production. Do not rely on replica reads for security decisions or read-after-write correctness.

## Initial cost posture

Start without Redis and without a separate message broker. Use Supabase Postgres plus a transactional outbox and Vercel Functions. Introduce a managed Redis service only after observing real bottlenecks or when distributed rate limiting becomes a launch requirement. Revisit provider and region selection against actual pricing and latency before provisioning.
