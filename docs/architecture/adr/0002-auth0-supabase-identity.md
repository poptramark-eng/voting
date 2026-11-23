# ADR 0002: Auth0 identity with Supabase authorization

- Status: Accepted
- Date: 2026-11-23

## Context

The platform is a multi-tenant voting SaaS. A person may belong to multiple organizations, and their organization roles and permissions must be managed by the platform rather than delegated to an external identity provider.

The application uses Supabase PostgreSQL with row-level security. Auth0 is selected for user authentication and federation.

## Decision

1. Auth0 is the sole application identity provider for the initial web release.
2. The Next.js application uses the official `@auth0/nextjs-auth0` SDK and server-managed sessions.
3. Supabase Third-Party Auth trusts the configured Auth0 tenant. Supabase Data API requests use the Auth0 ID token, not the access token.
4. An Auth0 Post-Login Action adds the literal ID-token claim `role: "authenticated"`. This is the PostgreSQL execution role, not an application permission.
5. `public.app_users` maps the immutable Auth0 `sub` to an internal UUID. Domain tables reference this internal UUID. RLS resolves the current application user from `auth.jwt() ->> 'sub'` through `private.current_app_user_id()`.
6. Organization membership, scoped roles, approvals and resource permissions remain in PostgreSQL and are checked server-side and by RLS.
7. Auth0 Organizations are not enabled initially. The product's organization model is authoritative; adding Auth0 Organizations later requires a specific enterprise SSO need and a reviewed mapping.
8. Auth0 tokens must use an asymmetric signing algorithm supported by Supabase Third-Party Auth. Do not use HS256 or PS256 for this integration.
9. Vercel hosts the Next.js application. Auth0 is configured as a standard Auth0 tenant/application and its secrets are stored in Vercel environment variables. Do not use the Vercel-native Auth0 integration by default because it provisions a new Auth0 tenant/application and has account/billing implications.
10. No Auth0 secret, Supabase service-role key, database password or private key is committed to Git or written into Notion.

## Consequences

- Global identity is independent of tenant membership.
- Users can join multiple organizations without duplicating their Auth0 identity.
- Supabase Auth's `auth.users` table is not a required identity store for application users.
- Database authorization depends on correct JWT verification, the ID-token role claim, and the application-user mapping.
- Auth0 tenant setup and Supabase Third-Party Auth configuration are required before end-to-end login can be tested.
- User provisioning must be idempotent and must never trust email as the immutable identity key.

## Security requirements

- Identify users by the exact Auth0 `sub`, never by email.
- Treat email and profile fields as mutable attributes.
- Never accept organization IDs, roles or permissions from client-controlled profile metadata.
- Enforce tenant scope in server-side authorization and PostgreSQL RLS.
- Keep privileged service-role credentials server-only; prefer user-scoped ID-token requests for normal application operations.
- Require MFA/step-up for sensitive platform administration and high-assurance election operations.
- Log authentication and authorization events without recording tokens or secret ballot choices.
