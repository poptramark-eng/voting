import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type Auth0IdentityProfile = {
  sub: string;
  email?: string | null;
  email_verified?: boolean;
  name?: string | null;
};

/**
 * Synchronizes the validated Auth0 subject and profile into the application
 * identity table. Only a provider-verified email is persisted because this
 * address participates in invitation and membership workflows.
 *
 * Call only with the user object from the validated Auth0 SDK session; never
 * accept an Auth0 subject or profile from browser input.
 */
export async function provisionApplicationIdentity(profile: Auth0IdentityProfile) {
  if (!profile.sub || !profile.sub.trim()) {
    throw new Error("AUTH0_SUBJECT_MISSING");
  }

  const identity = {
    auth_subject: profile.sub,
    email: profile.email_verified === true && typeof profile.email === "string"
      ? profile.email.trim().toLowerCase()
      : null,
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
