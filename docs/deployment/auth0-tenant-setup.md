# Auth0 tenant and application setup

This guide provisions the identity provider for the Voting Platform. Auth0 is used only for authentication. The application's Supabase database remains authoritative for internal users, organization memberships, roles, and permissions.

## Provisioning boundary

The current connected workspace does not expose an Auth0 tenant-management API or an authenticated Auth0 CLI session. The account owner must create the Auth0 account and first tenant in the Auth0 dashboard. Do not share passwords, client secrets, recovery codes, or MFA codes in chat, GitHub, or Notion.

## 1. Create the Auth0 account and tenant

1. Open [Auth0 sign up](https://auth0.com/signup).
2. Sign up or sign in with the account you want to own the platform's Auth0 tenant.
3. During tenant creation, select the **Europe (EU)** region. This is the recommended initial region because the Supabase project is hosted in Frankfurt. Auth0 tenant region is a foundational data-residency choice; verify the region before creating the tenant because it cannot simply be changed later.
4. Choose a stable tenant name. The resulting domain will look like `your-tenant.eu.auth0.com` or the domain shown by the dashboard. Copy the exact domain displayed; do not include `https://` in `AUTH0_DOMAIN`.

Auth0's signup page currently offers a free-plan starting option without requiring a credit card. Review the current plan limits and terms before relying on it for production workloads.

## 2. Create the web application

In the Auth0 Dashboard:

1. Open **Applications → Applications → Create Application**.
2. Name it `Voting Platform`.
3. Select **Regular Web Application** (not Single Page Application).
4. Use the following exact URL allowlists.

### Allowed Callback URLs

```text
http://localhost:3000/auth/callback
https://voting-mark-machukhus-projects.vercel.app/auth/callback
```

### Allowed Logout URLs

```text
http://localhost:3000
https://voting-mark-machukhus-projects.vercel.app
```

### Allowed Web Origins

```text
http://localhost:3000
https://voting-mark-machukhus-projects.vercel.app
```

Save the application. From its Settings page, copy the **Domain**, **Client ID**, and **Client Secret**. Keep the Client Secret private.

## 3. Add the Supabase ID-token role claim

Supabase Third-Party Auth integration expects the Postgres role claim `role: "authenticated"` in the Auth0 **ID token**. This is a database connection role, not an application permission or voting-platform role.

1. In Auth0, open **Actions → Library → Build Custom**.
2. Name the Action `Supabase authenticated role claim`.
3. Select the **Login / Post Login** trigger.
4. Use this code:

```javascript
exports.onExecutePostLogin = async (event, api) => {
  api.idToken.setCustomClaim('role', 'authenticated');
};
```

5. Save, deploy, and add the Action to the **Login** flow.
6. Confirm that the claim is present in the ID token. Do not rely on a similarly named access-token claim.

Do not add organization roles, platform roles, or voter eligibility to Auth0 claims. Those are resolved from the application's own database and policies.

## 4. Configure Vercel environment variables

Open the Vercel project **voting → Settings → Environment Variables**.

Add these values:

| Variable | Value | Environment |
|---|---|---|
| `AUTH0_DOMAIN` | Exact tenant domain, without scheme | Production, Preview, Development |
| `AUTH0_CLIENT_ID` | Application Client ID | Production, Preview, Development |
| `AUTH0_CLIENT_SECRET` | Application Client Secret | Production, Preview, Development |
| `AUTH0_SECRET` | Fresh cryptographically random 32-byte secret (hex is suitable) | Production, Preview, Development |
| `APP_BASE_URL` | `https://voting-mark-machukhus-projects.vercel.app` | Production |
| `APP_BASE_URL` | `http://localhost:3000` | Development |

For Preview, initially leave `APP_BASE_URL` unset so the SDK can infer the preview request host. Only add a preview base URL if you also register its exact callback and logout URLs in Auth0.

Generate `AUTH0_SECRET` locally with:

```bash
openssl rand -hex 32
```

Never commit these values or put them in `.env.example`. Enter the Client Secret and generated session secret directly into Vercel's encrypted environment-variable UI.

## 5. Configure Supabase Third-Party Auth

In the Supabase project `nvfpvzltubsczyrnwskh`:

1. Open **Authentication → Third-Party Auth** (or the current Third-Party Auth settings section).
2. Add **Auth0** as a provider.
3. Enter the exact Auth0 tenant issuer/domain requested by Supabase.
4. Save and verify the provider configuration.

Use the Auth0 **ID token** when making Supabase Data API requests. Do not substitute the Auth0 access token. Keep the existing RLS policies enabled and test that a signed-in user maps by immutable Auth0 `sub` to `app_users.auth_subject`.

## 6. Finish the application configuration

After the tenant and app exist:

- Set Vercel environment variables.
- Confirm the Auth0 Post-Login Action is deployed and attached to Login.
- Configure Supabase Third-Party Auth.
- Redeploy the Vercel project after environment variables are saved.
- Test sign-in, callback, sign-out, ID-token claims, user provisioning, and RLS access.
- Verify a user cannot read another organization's rows by changing IDs in requests.

## Current status

- Vercel project `voting` is linked to `poptramark-eng/voting`; first production deployment is READY.
- Next.js Auth0 SDK scaffold and proxy are committed.
- Supabase identity mapping uses `app_users.auth_subject` for the exact Auth0 `sub`.
- Auth0 account/tenant and Regular Web Application have **not** yet been provisioned.
- No Auth0 or Supabase credentials have been committed to source control.
