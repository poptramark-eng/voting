# Auth0 + Supabase + Vercel integration

Status: architecture and database mapping prepared; external tenant/project configuration is pending.

## Responsibility boundaries

- Auth0 authenticates people and manages login, recovery, MFA and federation.
- Supabase PostgreSQL owns application users, organization memberships, roles, permissions and all voting domain records.
- Vercel hosts the Next.js App Router application and server-side routes.
- The Auth0 subject (`sub`) is the stable external identity key. Email is not an identity key.

## Supabase identity mapping

The database contains `public.app_users` with:
- `id`: internal UUID used by domain tables
- `auth_subject`: unique external Auth0 subject
- `email` and `display_name`: mutable profile attributes

`private.current_app_user_id()` resolves the current JWT subject against `app_users.auth_subject`. RLS helper functions use this internal UUID.

Migration `20261123170000_remove_supabase_auth_foreign_keys_for_auth0.sql` removes the old foreign keys to `auth.users`. Domain foreign keys to `app_users` remain.

## Configure Supabase Third-Party Auth

In the Supabase Dashboard for project `nvfpvzltubsczyrnwskh`:
1. Open Authentication settings.
2. Open Third-Party Auth.
3. Add Auth0 and enter the Auth0 tenant ID and tenant region if applicable.
4. Save and verify the integration is enabled.

Official guide: https://supabase.com/docs/guides/auth/third-party/auth0

## Configure Auth0

Create a **Regular Web Application** for the Next.js application.

Configure a Post-Login Action (Post Login trigger):

```js
exports.onExecutePostLogin = async (event, api) => {
  api.idToken.setCustomClaim('role', 'authenticated');
};
```

Important:
- The claim must be on the ID token.
- Use the literal claim name `role`.
- Do not set this claim to an application role such as OWNER or ADMIN. It only selects Supabase's PostgreSQL `authenticated` role.
- Use an asymmetric signing algorithm supported by Supabase. HS256 and PS256 are unsupported for this integration.
- Do not put organization membership or authorization roles in Auth0 metadata as the source of truth.

## Next.js SDK configuration

Use the official `@auth0/nextjs-auth0` SDK (v4 line) with the Next.js 16 `proxy.ts` convention.

Required server-only environment variables:

```dotenv
AUTH0_SECRET=<random-32-byte-or-longer-secret>
APP_BASE_URL=http://localhost:3000
AUTH0_DOMAIN=<tenant-domain-without-https>
AUTH0_CLIENT_ID=<regular-web-app-client-id>
AUTH0_CLIENT_SECRET=<regular-web-app-client-secret>
NEXT_PUBLIC_SUPABASE_URL=https://nvfpvzltubsczyrnwskh.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<supabase-publishable-key>
```

The Supabase publishable key is designed for client use; the Auth0 credentials and all service-role/database credentials must remain server-only. Do not add `NEXT_PUBLIC_` to any secret.

Use the Auth0 ID token for Supabase Data API requests. The Supabase JS client supports an `accessToken` callback; in the Next.js server integration, provide the current session's raw ID token through that callback. Do not substitute the Auth0 access token: Supabase's Auth0 guide specifically relies on the ID token because it carries the required custom role claim.

Do not implement token extraction from unverified client input. Resolve the token from the server-validated Auth0 session.

## Vercel setup

The GitHub repository is `poptramark-eng/voting`. Once the Vercel team connection is authorized:
1. Create or reuse a Vercel project linked to this repository.
2. Use the repository root as the project root.
3. Configure environment variables separately for Development, Preview and Production.
4. Set `APP_BASE_URL` to the canonical production URL in Production. For local development use `http://localhost:3000`.
5. Configure Auth0 Allowed Callback URLs for local development and the production URL using the SDK callback path `/auth/callback`.
6. Configure Allowed Logout URLs for local development and the production URL.
7. Add Preview callback URLs deliberately; preview URLs are dynamic and must not be handled with an unsafe wildcard policy.
8. Redeploy after changing environment variables.

Do not install the Vercel-native Auth0 integration without a separate decision. It provisions a new Auth0 tenant/application; it does not simply attach an existing tenant.

## Required verification before feature work

- Auth0 login, callback, session renewal and logout work locally and on Vercel Preview.
- Auth0 ID token contains `sub` and literal `role=authenticated`.
- Supabase accepts the ID token as a third-party JWT.
- First authenticated request provisions exactly one `app_users` row for the Auth0 subject.
- Repeated login does not create duplicate app users.
- RLS resolves the same internal app user and blocks cross-organization reads/writes.
- No request can self-assign organization roles.
- No tokens or credentials appear in logs, browser bundles, Git history or Notion.

## Cost and operational notes

- Keep the initial architecture on the Supabase project already created and Vercel's existing available plan.
- Review Auth0 MAU and feature limits before production onboarding.
- Supabase Third-Party Auth usage has plan quotas and overage pricing; check current billing before large-scale rollout.
- Redis remains deferred. Do not add it solely for session storage while using Auth0's managed sessions.
