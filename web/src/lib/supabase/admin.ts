import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdminEnv } from "@/lib/config/env";

export function createSupabaseAdminClient(): ReturnType<typeof createClient> {
  const env = getSupabaseAdminEnv();
  return createClient(env.url, env.secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
