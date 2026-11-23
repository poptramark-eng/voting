# Product decisions and requirements baseline

Status: discovery baseline, not a legally certified election specification.

## Product vision and market

- Initial market: Kenya.
- Product supports general polls, contests and competitions, organizational elections, and public-election workflows only after separate legal authorization and assurance.
- Shared voting core with process-specific rules and assurance tiers.
- Initial customer validation: universities and colleges, then associations and societies, then businesses.
- Launch sequence: general polls and organizational elections; contests; advanced institutional elections; public-election capabilities only after legal, security and operational approval.
- Operating model: shared SaaS first, then dedicated SaaS, then self-hosted when operational tooling is mature.

## Commercial model

- Process-level choice of organizer-funded, voter-funded or hybrid participation fees, subject to legal review.
- Configurable fee destination: organizer, platform or revenue sharing.
- Payment is separate from eligibility and ballot casting; successful payment never automatically casts a vote.
- Platform billing is separate from participation payments.
- Support subscriptions, per-process, usage-based, premium features, institutional contracts, discounts and trials.
- Provider-independent payment abstraction; Kenya-first integrations may include mobile money, cards and banks. Settlement arrangements require contractual and regulatory review.
- Multi-currency support; preserve original currency and amount, exchange-rate source and timestamp.

## Organizations, identity and permissions

- Multi-tenant organizations with isolated workspaces, departments/branches, multiple members and multiple roles.
- Unified platform identity with external identity federation and organization-specific memberships.
- Account identity, authentication, identity verification and process eligibility are distinct.
- Configurable RBAC plus scoped permissions and custom roles; separation of duties for sensitive actions.
- Platform governance is separate from organization governance; platform safeguards cannot be overridden.
- Organization onboarding combines self-service registration, verification, platform approval for selected categories and assisted institutional onboarding.
- Pending workspaces remain restricted until required approval.
- Organization-controlled workspace data with platform-governed security, retention and election-evidence protections.

## Voting process model

- An election event can contain multiple independent voting processes; each process can contain multiple contests, positions or questions.
- Ballot items include candidates, teams, groups, parties, proposals and ordinary options.
- Ballot formats: single-choice, multiple-choice, ranked-choice, yes/no or approval, and scored voting. Counting and tie-breaking rules must be explicit.
- Voter eligibility: open link, invitation-only, organizer-managed lists and bulk imports, verified membership, or combinations.
- Voter register inputs: manual, CSV/Excel, controlled self-registration, institutional integrations. Include duplicate detection, validation, versioning, finalization and audited post-finalization changes.
- Ballot secrecy is foundational. Identity and ballot content must be separated; provide acceptance/inclusion verification without revealing choices. A hash chain alone is not proof of correct election outcomes.
- Vote replacement policy is configurable: disabled, unlimited or limited; only final valid ballot counts and prior choices remain secret.
- Result disclosure configurable: live, after closure, scheduled or custom. Distinguish preliminary, verified and certified results.
- Process lifecycle supports automatic/manual closure, extension, suspension, emergency termination and resumption with immutable event records.
- Offline operation is deferred; any later controlled offline mode requires encrypted local storage, device authorization, tamper evidence, duplicate prevention and conflict handling.
- Formal disputes, appeals, recounts, independent audits and correction history are required; original results remain preserved.

## Security, privacy and assurance

- Risk-based assurance tiers: standard, enhanced, high assurance and critical.
- Authentication is risk-based and configurable: passwords, passwordless, OTP, MFA and institutional SSO, with secure recovery and session controls.
- Fraud controls include rate limits, bot protection, anomaly detection, risk scoring, investigation workflows and human review. Do not automatically invalidate legitimate ballots solely from risk scores.
- Independent observer and auditor roles are read-only, scoped and time-limited; no observer may alter registers, ballots or results.
- Configurable transparency: public disclosures, restricted observer evidence and confidential identity/ballot/investigation data.
- Audit architecture should support append-only evidence, signatures, verifiable checkpoints and independent review; research established end-to-end verifiable voting protocols before implementation.
- Data minimization, retention, access/correction/portability/deletion and legal holds. Deletion must not erase records that must lawfully be retained.
- Backups, geographically separated storage, PITR, restore drills and election-specific continuity; define RPO/RTO per assurance tier.
- Never claim software alone makes a system legally or operationally fit for public elections.

## Service quality and user experience

- Enterprise-scale long-term target: millions of registered users and potentially hundreds of thousands of concurrent voters, achieved through staged capacity planning and load testing.
- Tiered availability and performance targets; measure voting, authentication, payments, notifications and reporting separately.
- Ballot acceptance acknowledgement only after durable persistence and integrity checks.
- Internationalization foundation; launch English and Kiswahili, with future language packs, regional formats and RTL support.
- WCAG 2.2 AA minimum; enhanced accessibility and independent testing for critical voting workflows.
- Omnichannel direction: web, mobile apps, APIs, email/SMS invitations and low-connectivity support. Advanced mobile apps and offline voting are deferred from initial release.
- Tiered support: knowledge base, tickets, email, live chat and dedicated institutional support; critical-election incident escalation.
- Configurable notifications via email, SMS, push and in-app; delivery tracking, retries, consent and cost controls. Never include ballot choices.

## Integrations, reporting and portability

- REST APIs, webhooks, SSO, identity/institutional systems, membership/HR/student systems, payment and communication providers.
- Scoped credentials, rotation, signed webhooks, replay protection, idempotency, rate limits and sandbox tooling.
- Operational, analytical, governance and audit reporting; CSV/Excel/PDF exports and scheduled reports with privacy-preserving aggregation.
- Complete exports/migration for registers, configurations, financial records, audit evidence, disputes and reports, with versioned schemas and integrity checks.

## First release

Build an enterprise-ready foundation: organizations, permissions, voting process lifecycle, voter registration, ballot formats, secrecy boundaries, results, audit, initial payments, email/in-app notifications and approval workflows.

Defer extensive integrations, advanced mobile apps, offline voting, advanced analytics and self-hosted deployment until later. Security, tenant isolation, ballot secrecy and auditability are non-negotiable.

## Decisions requiring validation before production

- Kenya legal/regulatory analysis for each voting category, payment collection/settlement, data protection, hosting and cross-border transfers.
- Threat model and independently reviewed end-to-end verifiable voting protocol.
- Exact counting/tie-break algorithms per ballot format.
- Service-level objectives, load profiles, RPO/RTO and operational runbooks.
- Data retention schedule and legal holds.
- Payment-provider eligibility, fees, settlement and refund rules.
- Public-election authorization and independent assurance requirements.

## Discovery governance

Decisions 1–51 were selected by the product owner in the structured discovery conversation. Decisions 52–54 were recommended by the assistant and accepted as the working direction only where explicitly confirmed; Decision 52 transparency was expressly accepted. Treat the observer/auditor model (53) and data-control model (54) as adopted working recommendations pending explicit review.