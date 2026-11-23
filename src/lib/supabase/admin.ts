import "server-only";

import { createClient } from "@supabase/supabase-js";

/**
 * Privileged client for narrowly scoped server-side billing writes only.
 * Never import this module from a Client Component or expose its key.
 */
export function createSupabaseAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("SUPABASE_ADMIN_ENVIRONMENT_MISSING");
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}
