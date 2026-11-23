import { auth0 } from "@/lib/auth0";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createVoterRegisterRouteHandlers } from "@/lib/voter-register-route";

const handlers = createVoterRegisterRouteHandlers({
  getSession: async () => auth0.getSession(),
  readRows: async (processId, mode, limit, offset) => {
    const supabase = await createSupabaseServerClient();
    return supabase.rpc("read_voter_register_entries", {
      target_process: processId,
      target_access_mode: mode,
      target_limit: limit,
      target_offset: offset,
    });
  },
});

export const GET = handlers.GET;
export const POST = handlers.POST;
