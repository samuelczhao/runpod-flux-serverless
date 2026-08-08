import { createServerClient, type CookieMethodsServer } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { getSupabasePublicEnv } from "@/lib/config/env";
import type { Database } from "@/lib/database/types";

export async function createSupabaseServerClient(): Promise<SupabaseClient<Database>> {
  const cookieStore = await cookies();
  const env = getSupabasePublicEnv();
  const methods: CookieMethodsServer = {
    getAll: () => cookieStore.getAll(),
    setAll: (values) => setServerCookies(cookieStore, values),
  };
  return createServerClient<Database>(env.url, env.publishableKey, { cookies: methods });
}

function setServerCookies(
  store: Awaited<ReturnType<typeof cookies>>,
  values: Parameters<NonNullable<CookieMethodsServer["setAll"]>>[0],
): void {
  try {
    values.forEach(({ name, value, options }) => store.set(name, value, options));
  } catch (error: unknown) {
    // Proxy refreshes cookies when a Server Component cannot mutate them.
    void error;
  }
}
