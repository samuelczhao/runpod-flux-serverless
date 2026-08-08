import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdminEnv } from "@/lib/config/env";
import type { Database } from "@/lib/database/types";

export function createSupabaseAdminClient(): SupabaseClient<Database> {
  const env = getSupabaseAdminEnv();
  return createClient<Database>(env.url, env.secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
