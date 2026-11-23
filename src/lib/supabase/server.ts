import "server-only";

import { createClient } from "@supabase/supabase-js";
import { auth0 } from "@/lib/auth0";
import type { Database } from "@/types/database.types";

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

  const supabase = createClient<Database>(supabaseUrl, supabasePublishableKey, {
    accessToken: async () => idToken,
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });

  // Provision or synchronise the internal UUID mapped to the immutable Auth0 sub.
  // Column privileges and RLS ensure the caller can only write their own identity.
  const { error } = await supabase.from("app_users").upsert(
    {
      auth_subject: session.user.sub,
      email: session.user.email ?? null,
      display_name: session.user.name ?? null,
    },
    { onConflict: "auth_subject" }
  );

  if (error) {
    // Keep provider/database details out of the response; the server log retains
    // the original Supabase error for diagnosis.
    console.error("Supabase application identity provisioning failed:", error);
    throw new Error("Unable to provision the authenticated application identity.");
  }

  return supabase;
}
