# Deploying the Voting Platform on Deno Deploy

This repository is a Next.js 16 App Router application. Deno Deploy currently documents support for Next.js App Router, SSR, API routes and the Next.js framework preset. Use the **Next.js** framework preset and a **dynamic/server-side** application; do not configure this project as a static site.

> **Platform lifecycle warning (24 November 2026):** Deno has announced that Deno Deploy will be sunset in April 2027. It is suitable for your trial and short-term hosting test, but choose a longer-lived hosting provider before relying on it for a production election.

## 1. Requirements

- Git and access to this repository.
- Node.js 22.x for local development and the repository's npm scripts.
- npm.
- A Deno account and the current Deno CLI.
- An Auth0 **Regular Web Application**.
- A Supabase project with the repository migrations applied.
- Paystack credentials only if you intend to test organization billing.

## 2. Get the project running locally

Clone the repository and enter its root directory:

```bash
git clone https://github.com/poptramark-eng/voting.git
cd voting
```

Install dependencies and create the local environment file.

**Windows PowerShell**
```powershell
Copy-Item .env.example .env.local
npm ci
```

**macOS/Linux**
```bash
cp .env.example .env.local
npm ci
```

Fill in the values described in [Environment variables](#5-environment-variables). Generate an Auth0 cookie/session secret with:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Run the local quality checks:

```bash
npm run typecheck
npm test
npm run lint
npm run build
npm run dev
```

Open http://localhost:3000.

## 3. Configure Auth0

1. In the Auth0 Dashboard, create or select a **Regular Web Application**.
2. Copy its Domain, Client ID and Client Secret into `.env.local`.
3. Set `AUTH0_SECRET` to the generated random 32-byte hex value.
4. Set `APP_BASE_URL=http://localhost:3000` locally. On Deno Deploy, set it to the exact HTTPS origin of the deployed application, without a trailing slash.
5. Add these URLs to the Auth0 application's settings:
   - Allowed Callback URLs: `http://localhost:3000/auth/callback`
   - Allowed Logout URLs: `http://localhost:3000`
   - Allowed Web Origins: `http://localhost:3000`
6. Repeat the URL entries for the deployed HTTPS origin after creating the Deno app.

### Supabase role claim in the Auth0 ID token

The Supabase Third-Party Auth integration expects the Auth0 ID token to include `role: authenticated`. Add this Post-Login Action and enable it in the active Login flow:

```javascript
exports.onExecutePostLogin = async (event, api) => {
  api.idToken.setCustomClaim('role', 'authenticated');
};
```

The application checks this ID-token claim before connecting to Supabase. The database still makes authorization decisions from PostgreSQL memberships, scoped roles and RLS; do not put organization roles in this Auth0 claim.

## 4. Configure Supabase

1. Create/select a Supabase project.
2. In Supabase Authentication / Third-Party Auth, configure Auth0 as a trusted provider using your Auth0 issuer/domain. Follow the current Supabase dashboard instructions for the exact issuer and audience fields.
3. Copy the project URL and publishable key into:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
4. Only if using the server-side Paystack ledger/webhook functionality, set `SUPABASE_SERVICE_ROLE_KEY` as a server secret. Never expose it to the browser.

### Database migrations — read this before running commands

The repository contains the versioned SQL migrations under `supabase/migrations/`. The staging database was validated against the current 12-migration repository chain. The existing production database previously had only the first nine migration versions applied; do not assume that production is already at the repository's current schema.

For a **new, empty Supabase project**, install the Supabase CLI, authenticate, link the project, inspect the migration list, then apply the repository migrations:

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase migration list
npx supabase db push
npx supabase migration list
```

Review the planned migrations and target project before confirming `db push`. For an existing database, first reconcile its migration history and actual schema with the repository. Do not blindly run `db push` against the existing production project: migration-history drift can make a valid schema appear untracked or cause duplicate DDL. Take a recoverable backup and test the exact migration sequence on a separate staging database first.

The application needs the baseline organization/election schema as well as the process lifecycle, payment-ledger and voter-PII migrations. Applying only the newest migration files to an empty database will not work.

## 5. Environment variables

Set all required application variables in the Deno Deploy **Production** context. Keep the same names as `.env.example`.

| Variable | Required? | Visibility | Purpose |
|---|---|---|---|
| `AUTH0_SECRET` | Yes | Secret | Encrypts Auth0 session/transaction cookies. Use a strong random value; do not reuse a sample. |
| `AUTH0_DOMAIN` | Yes | Non-secret | Auth0 tenant domain, without `https://`. |
| `AUTH0_CLIENT_ID` | Yes | Non-secret | Auth0 Regular Web Application client ID. |
| `AUTH0_CLIENT_SECRET` | Yes | Secret | Auth0 client secret. |
| `APP_BASE_URL` | Yes for this deployment | Non-secret | Exact public application origin, e.g. `https://your-app.deno.dev`. Used by Auth0 and Paystack callback URLs. |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Public | Supabase project URL. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Yes | Public | Supabase publishable key. RLS is still required. |
| `SUPABASE_SERVICE_ROLE_KEY` | Billing only | Secret | Privileged server-side key used by the narrow billing/webhook implementation. |
| `PAYSTACK_SECRET_KEY` | Billing only | Secret | Paystack test or live API secret. |
| `PAYSTACK_WEBHOOK_SECRET` | Billing only | Secret | Current Paystack webhook signing secret. |
| `PAYSTACK_WEBHOOK_SECRET_PREVIOUS` | Optional | Secret | Previous signing secret only during a controlled key rotation. |
| `PAYSTACK_PRICE_CATALOG_JSON` | Billing only | Secret/server config | Server-controlled price-code catalog JSON. |
| `CRON_SECRET` | Billing retry only | Secret | Random bearer secret for the internal webhook retry endpoint. |

Only the two `NEXT_PUBLIC_*` Supabase values are intentionally browser-visible. All other values must remain server-side secrets. Do not paste real credentials into GitHub, source files, issue comments or chat.

For local development, use `.env.local`. For Deno Deploy, add the variables in the application's Environment Variables settings and mark secret values as **Secrets**. Do not upload the example file with empty values as your production configuration.

### Paystack price catalog example

Only configure this if you are testing the optional organization billing foundation. Example format (not a recommended price):

```json
{
  "org-monthly": {
    "amountMinor": 10000,
    "currency": "KES",
    "description": "Example organization monthly plan"
  }
}
```

The browser supplies a price code, not an amount. The server reads the amount/currency from this catalog. The sample value is illustrative; decide your actual prices before enabling checkout. Start with Paystack test credentials.

## 6. Deploy to Deno Deploy

### Option A — connect GitHub (recommended)

1. Open the Deno Deploy dashboard and create an application connected to `poptramark-eng/voting`.
2. Select the `main` branch.
3. Select the **Next.js** framework preset (the preset is called `nextjs` in the CLI).
4. Use the dynamic/server-side runtime. Do not choose static export.
5. Let the framework preset detect the build settings. If it asks for commands, use:
   - Install: `npm ci`
   - Build: `npm run build`
6. Choose a deployment region close to your Supabase database region to reduce database round-trip latency.
7. Add the environment variables from section 5 to the Production context. Set `APP_BASE_URL` to the final HTTPS app URL.
8. Deploy the `main` branch and inspect the build/runtime logs.

### Option B — create/deploy with the Deno CLI

Install/update Deno from the official Deno installation instructions, then authenticate:

```bash
deno --version
deno deploy create
```

Use the interactive wizard and select the repository, **Next.js** framework preset, dynamic runtime and a region near your database. The CLI also supports GitHub-backed app creation with `--source github`, `--owner poptramark-eng`, `--repo voting` and `--framework-preset nextjs`.

After the app exists, add the environment variables in the Deno Deploy dashboard (or use the CLI's `deno deploy env` commands). Then deploy from the linked GitHub branch or, if deploying from a local checkout:

```bash
deno deploy
```

Use the CLI's current `deno deploy --help` output if command flags have changed. Deno Deploy's Next.js preset handles its standalone build/runtime integration; do not add a custom Node server or force a static export.

### Auth0 URLs after deployment

Once you know the Deno app's HTTPS origin, set `APP_BASE_URL` to it and add:

- `https://YOUR-DENO-APP-ORIGIN/auth/callback` to Allowed Callback URLs.
- `https://YOUR-DENO-APP-ORIGIN` to Allowed Logout URLs.
- `https://YOUR-DENO-APP-ORIGIN` to Allowed Web Origins.

Redeploy/restart after changing environment values if the platform requires it.

## 7. Configure the Paystack webhook (optional)

Do this only after the billing database migrations and server-side secrets are configured.

1. Start with Paystack test credentials.
2. Configure the webhook URL as `https://YOUR-DENO-APP-ORIGIN/api/webhooks/paystack`.
3. Put the Paystack API secret and webhook signing secret in Deno Deploy secrets.
4. Configure `PAYSTACK_PRICE_CATALOG_JSON` with the price codes and amounts you have actually approved.
5. Configure the GitHub Actions repository variable `APP_BASE_URL` and repository secret `CRON_SECRET` for `.github/workflows/paystack-webhook-retry.yml`. Use the same `CRON_SECRET` as the application.
6. Test checkout, signature rejection, duplicate webhook delivery and server-side transaction verification using the checklist in [Paystack integration](../payments/paystack-integration.md).

The existing payment code is a billing ledger/checkout/webhook foundation. It does **not** yet provide complete subscription entitlements, refunds, settlement reconciliation or voter payments.

## 8. Post-deployment smoke test

- [ ] Landing page loads over HTTPS.
- [ ] Auth0 login and callback work.
- [ ] Logout works.
- [ ] Auth0 ID token contains the `role=authenticated` custom claim.
- [ ] Supabase identity provisioning succeeds.
- [ ] A user can create an organization and open its workspace.
- [ ] Organization/event/process access is correctly isolated between accounts.
- [ ] Event and process configuration pages load.
- [ ] Process submission, approval, suspension and resumption controls enforce the expected roles.
- [ ] Voter PII access requests and restricted register reads enforce approval, expiry, scope and audit logging.
- [ ] Billing is tested only with Paystack test mode if enabled.
- [ ] No service-role key, Auth0 secret or Paystack secret appears in browser bundles or logs.

## 9. Current product limitations — do not use for a live election

This repository is **not yet a complete, independently assured voting system**. The following capabilities are not implemented/validated as operational end-to-end features:

- Voter-register import and full voter-management UI.
- Secure voter authentication/eligibility credential issuance and redemption.
- Ballot casting, duplicate-vote prevention and ballot replacement rules.
- Independently reviewed cryptographic ballot secrecy and verifiability protocol/key management.
- Deterministic tallying, independent verification, certification, recount and publication workflows.
- Complete billing subscription entitlements/refunds/settlement reconciliation.
- Full operational monitoring, backup/recovery runbooks and production end-to-end tests.

The current interface supports organization workspaces and event/process/ballot-structure configuration. The lifecycle and voter-PII governance foundations are implemented, but those are not substitutes for the missing ballot box and tally domains. Do not use the platform for binding institutional or public elections until those components are implemented, independently reviewed, tested under realistic conditions and approved under applicable law.

## Official references

- [Deno Deploy Next.js framework support](https://docs.deno.com/deploy/reference/frameworks/)
- [Deno Deploy getting started](https://docs.deno.com/deploy/getting_started/)
- [Deno Deploy CLI](https://docs.deno.com/runtime/reference/cli/deploy/)
- [Deno Deploy environment variables](https://docs.deno.com/deploy/reference/env_vars_and_contexts/)
- [Auth0 Next.js SDK v4](https://auth0.github.io/nextjs-auth0/)
- [Supabase Third-Party Auth](https://supabase.com/docs/guides/auth/third-party/overview)
- [Supabase CLI migrations](https://supabase.com/docs/guides/deployment/database-migrations)
