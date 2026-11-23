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

This repository is being initialized from the product-discovery decisions. The initial implementation will establish domain boundaries, database migrations, API contracts, tests and deployment foundations before building voter-facing workflows.

## Documentation

- `docs/product/decisions.md` — accepted product decisions and constraints.
- `docs/architecture/README.md` — initial architecture direction and unresolved design work.
- `supabase/migrations/` — versioned database schema migrations.

## Important scope note

This is not a claim that software alone is suitable or legally authorized to conduct public elections. Public-election use requires jurisdiction-specific legal review, independent security assessment, operational readiness and appropriate authorization.
