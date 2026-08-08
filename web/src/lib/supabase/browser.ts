import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabasePublicEnv } from "@/lib/config/env";
import type { Database } from "@/lib/database/types";

export function createSupabaseBrowserClient(): SupabaseClient<Database> {
  const env = getSupabasePublicEnv();
  return createBrowserClient<Database>(env.url, env.publishableKey);
}
