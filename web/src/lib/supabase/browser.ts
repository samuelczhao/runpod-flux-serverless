import { createBrowserClient } from "@supabase/ssr";
import { getSupabasePublicEnv } from "@/lib/config/env";

export function createSupabaseBrowserClient(): ReturnType<typeof createBrowserClient> {
  const env = getSupabasePublicEnv();
  return createBrowserClient(env.url, env.publishableKey);
}
