# Voting Platform

A Kenya-first, enterprise-oriented platform for managing polls, contests, organizational elections and (subject to separate legal authorization and assurance) public-election workflows.

## Product principles

- Ballot secrecy and verifiable election integrity by design.
- Eligibility, identity verification, authentication, payment and ballot submission are separate concerns.
- Multi-tenant organization workspaces with scoped permissions and separation of duties.
- Configurable process rules with non-overridable platform security safeguards.
- Accessible, multilingual and resilient voter experiences.
- Phased delivery: start with ordinary polls and institutional elections; expand only after validation and assurance.

## Repository status

The repository contains the Auth0/Supabase multi-tenant foundation, organization onboarding, process-lifecycle governance, a purpose-bound voter PII access-grant/API foundation and a Paystack organization-billing integration foundation. These database changes remain on the feature branch and have not been applied to the hosted database. Ballot acceptance, cryptographic voting, tallying and subscription entitlements are not implemented.

## Documentation

- `docs/product/decisions.md` — accepted product decisions and constraints.
- `docs/architecture/README.md` — architecture direction and delivery status.
- `docs/architecture/organization-access-model.md` — organization roles, scoped access and governance decisions.
- `docs/architecture/process-lifecycle.md` — lifecycle states, transition rules and API contracts.
- `docs/security/voter-pii-access.md` — purpose-bound voter PII grants, approval thresholds, data minimization, audit rules and API contracts.
- `docs/payments/paystack-integration.md` — server-side checkout, webhook verification and setup.
- `supabase/migrations/` — versioned database schema migrations.

## Important scope note

This is not a claim that software alone is suitable or legally authorized to conduct public elections. Public-election use requires jurisdiction-specific legal review, independent security assessment, operational readiness and appropriate authorization.
