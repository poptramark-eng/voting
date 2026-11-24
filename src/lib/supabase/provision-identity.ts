import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type Auth0IdentityProfile = {
  sub: string;
  email?: string | null;
  name?: string | null;
};

/**
 * Synchronizes the verified Auth0 session identity into the private application
 * identity table. Call only with the user object from the validated Auth0 SDK
 * session; never accept an Auth0 subject from browser input.
 */
export async function provisionApplicationIdentity(profile: Auth0IdentityProfile) {
  if (!profile.sub || !profile.sub.trim()) {
    throw new Error("AUTH0_SUBJECT_MISSING");
  }

  const identity = {
    auth_subject: profile.sub,
    ...(typeof profile.email === "string" ? { email: profile.email } : {}),
    ...(typeof profile.name === "string" ? { display_name: profile.name } : {}),
  };

  const { error } = await createSupabaseAdminClient()
    .from("app_users")
    .upsert(identity, { onConflict: "auth_subject" });

  if (error) {
    console.error("Supabase application identity provisioning failed:", {
      code: error.code,
      message: error.message,
    });
    throw new Error("SUPABASE_IDENTITY_PROVISIONING_FAILED");
  }
}
