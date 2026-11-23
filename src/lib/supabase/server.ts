import "server-only";

import { createClient } from "@supabase/supabase-js";
import { auth0 } from "@/lib/auth0";

/**
 * Creates a request-scoped Supabase client authenticated with the Auth0 ID token.
 *
 * This helper is server-only: the Auth0 ID token must never be sent to browser
 * code. Supabase RLS remains the authorization boundary; application roles and
 * organization membership are resolved from the database, not Auth0 profile data.
 */
export async function createSupabaseServerClient() {
  const session = await auth0.getSession();
  const idToken = session?.tokenSet.idToken;

  if (!session?.user.sub || !idToken) {
    throw new Error("An authenticated Auth0 session with an ID token is required.");
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabasePublishableKey) {
    throw new Error("Supabase URL and publishable key must be configured.");
  }

  return createClient(supabaseUrl, supabasePublishableKey, {
    accessToken: async () => idToken,
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}
