# Authentication and authorization architecture

- Status: Adopted direction; provider configuration pending
- Date: 2026-11-23

## Responsibility split

- Auth0 is the identity provider: sign-in, account recovery, MFA, enterprise federation and authentication sessions.
- The application database is authoritative for internal user records, organization membership, scoped roles, approvals and election permissions.
- Process-specific voter eligibility is separate from organization membership.
- Auth0 authentication or an Auth0 Organization membership never grants permission to manage an election or cast a ballot by itself.

## Multi-tenant identity

Use one Auth0 tenant for the shared SaaS launch. Use Auth0 Organizations for enterprise login federation and organization-specific connections where useful. Do not create one Auth0 tenant per customer by default.

A person has one global application identity and may belong to multiple platform organizations. The user selects an active organization in the application; every server operation checks the active organization against the database membership and permission records. Auth0 Organization identifiers are mapped to internal organization records where configured, but the database remains authoritative.

## Supabase third-party authentication

Supabase's Auth0 integration accepts Auth0-issued asymmetric JWTs. Its documented integration requires the literal `role: authenticated` claim on the ID token, added with an Auth0 Post Login Action. Use the Auth0 ID token for Supabase requests as documented; do not substitute an ID token for a separate access token intended for another API.

The Supabase project must be configured with the Auth0 third-party provider (tenant and region). This dashboard configuration and the Auth0 Post Login Action are still pending because the connected Auth0 tenant is not currently accessible through an account-management tool in this session.

## Internal UUID mapping

Auth0 subjects (for example, `auth0|...`) are strings, not UUIDs. Existing database membership and creator columns use UUIDs and existing policies relied on `auth.uid()`. To avoid unsafe casts or a wholesale text-key migration:

- `public.app_users.id` is the stable internal UUID.
- `public.app_users.auth_subject` uniquely stores the verified Auth0 `sub`.
- `private.current_app_user_id()` resolves the JWT `sub` to the internal UUID.
- Organization authorization helpers use that resolver instead of `auth.uid()`.
- A trusted server-side identity synchronization operation must provision/update `app_users` after validating the Auth0 session. Never accept an arbitrary `sub` from browser input.
- The `app_users` table is inaccessible to ordinary clients; only the server-side service-role client can synchronize it.

The migration `20261123160000_auth0_identity_mapping.sql` implements the mapping and updates the organization-creation and creator policies. The migration has been applied and the generated TypeScript database types refreshed.

## Token and session rules

- Use the Auth0 Next.js SDK's server-side session model for the web application.
- Keep session cookies HttpOnly, Secure in production, SameSite appropriate and encrypted/signed by the SDK.
- Keep client secrets, session secrets and Supabase service-role keys server-only.
- Never put tokens in localStorage or expose the service-role key to the browser.
- Validate issuer, audience, signature and expiry when a token is used by a resource API.
- Use short-lived API access tokens with an explicit audience and scopes for separate APIs.
- Require MFA/step-up for high-risk administrator actions as the risk model matures.
- Use least privilege, revocation and auditable access changes.

## Authorization model

Authorization is layered:
1. Authentication: is this a valid signed-in identity?
2. Application identity: does the verified Auth0 subject map to an internal user?
3. Tenant membership: is the user an active member of this organization?
4. Scoped permission: may this member perform this action on this resource?
5. Process eligibility: is this person eligible for this particular voting process?
6. Ballot protocol: can an eligible credential submit a valid ballot without revealing identity-choice linkage?

RLS is defense in depth, not a replacement for application-level policy checks and security tests. Privileged server operations must still validate organization scope and action permissions.

## Required verification before launch

- Configure Auth0 in Supabase and verify the ID token is accepted as the authenticated Postgres role.
- Add the Post Login Action and test that the ID token has `role=authenticated`.
- Implement trusted `app_users` provisioning and ensure first-login race handling is idempotent.
- Test unmapped subjects resolve to no internal user and cannot read/write tenant data.
- Test cross-tenant reads/writes, suspended memberships, role changes, session revocation and organization switching.
- Confirm the Auth0 organization claim is never treated as a substitute for database authorization.
