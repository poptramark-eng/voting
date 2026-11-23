# Voting Platform

A Kenya-first, enterprise-oriented platform for managing polls, contests and organizational elections. Public-election workflows are disabled and require separate legal authorization, independent security assurance and operational approval.

## Product principles

- Ballot secrecy and verifiable election integrity by design.
- Eligibility, identity verification, authentication, payment and ballot submission are separate concerns.
- Multi-tenant organization workspaces with scoped permissions and separation of duties.
- Configurable process rules with non-overridable platform security safeguards.
- Accessible, multilingual and resilient voter experiences.
- Phased delivery: start with ordinary polls and institutional elections; expand only after validation and assurance.

## Current implementation status

The repository includes:

- Auth0 authentication and Supabase Third-Party Auth identity mapping.
- Multi-tenant organizations, memberships and the first-release organization/scoped-role authorization model.
- Organization workspace UI, voting-event and process configuration, contest/ballot-structure configuration.
- Approval-backed process submission, emergency suspension, controlled resumption and termination.
- Purpose-bound, time-limited voter PII access requests, assurance-tiered approvals, minimized audited register reads/exports.
- Paystack organization-billing checkout/webhook ledger foundation with server-side verification and retry handling.
- Automated tests, lint, TypeScript checks and production build in GitHub Actions.

The current repository is **not yet a complete voting system**. Voter-register import/management, voter eligibility credential lifecycle, secure ballot acceptance, cryptographic secrecy/verifiability, tallying, independent result verification, certification, recount and publication workflows remain incomplete. Paystack subscription entitlements, refunds and settlement reconciliation are also incomplete. Do not use this software for a binding election yet.

## Deployment and setup

- [Environment template](.env.example) — copy to `.env.local` and supply your own credentials.
- [Deno Deploy setup guide](docs/deployment/deno-deploy.md) — local setup, Auth0, Supabase migrations, environment variables, Deno Deploy and Paystack test configuration.
- [Paystack integration details](docs/payments/paystack-integration.md).

Deno Deploy currently supports Next.js App Router and SSR, but Deno has announced that Deno Deploy will be sunset in April 2027. Treat it as a short-term test/hosting target, not a long-term platform dependency.

## Architecture and governance documentation

- `docs/product/decisions.md` — accepted product decisions and constraints.
- `docs/architecture/README.md` — architecture direction and delivery status.
- `docs/architecture/organization-access-model.md` — organization roles, scoped access and governance decisions.
- `docs/architecture/process-lifecycle.md` — lifecycle states, transition rules and API contracts.
- `docs/security/voter-pii-access.md` — purpose-bound voter PII grants, approval thresholds, data minimization, audit rules and API contracts.
- `supabase/migrations/` — versioned database schema migrations.

## Local quality checks

```bash
npm ci
npm run typecheck
npm test
npm run lint
npm run build
```

## Security and legal scope

This repository is not a claim that software alone is suitable or legally authorized to conduct public elections. Public-election use requires jurisdiction-specific legal review, independent security assessment, operational readiness and appropriate authorization. Never commit secrets; never expose Supabase service-role keys to the browser; and do not treat payment as proof of voter eligibility or a vote.
