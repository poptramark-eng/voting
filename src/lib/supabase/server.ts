import "server-only";

import { createClient } from "@supabase/supabase-js";
import { auth0 } from "@/lib/auth0";
import { provisionApplicationIdentity } from "@/lib/supabase/provision-identity";
import type { Database } from "@/types/database.types";

function readJwtRoleClaim(token: string): string | undefined {
  try {
    const payload = token.split(".")[1];
    if (!payload) return undefined;
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      role?: unknown;
    };
    return typeof claims.role === "string" ? claims.role : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Creates a request-scoped Supabase client authenticated with the Auth0 ID token.
 * Supabase Third-Party Auth requires the literal role=authenticated claim on this
 * ID token. We inspect only that claim for diagnostics; Supabase verifies the JWT.
 */
export async function createSupabaseServerClient() {
  const session = await auth0.getSession();
  const idToken = session?.tokenSet.idToken;

  if (!session?.user.sub || !idToken) {
    throw new Error("AUTH_SESSION_MISSING");
  }

  const tokenRole = readJwtRoleClaim(idToken);
  if (tokenRole !== "authenticated") {
    // Never log or return the token itself, or any other token claims.
    console.error("Auth0 ID token is missing the Supabase role claim:", {
      hasRoleClaim: tokenRole !== undefined,
      roleClaim: tokenRole ?? null,
    });
    throw new Error("AUTH0_ID_TOKEN_ROLE_CLAIM_MISSING");
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabasePublishableKey) {
    throw new Error("SUPABASE_ENVIRONMENT_MISSING");
  }

  // Provision the trusted Auth0 identity through the server-only service-role
  // client. app_users intentionally has no ordinary-client write policy.
  await provisionApplicationIdentity(session.user);

  return createClient<Database>(supabaseUrl, supabasePublishableKey, {
    accessToken: async () => idToken,
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}
