import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export class AuthenticationError extends Error {
  public constructor(message = "Open your private journal before continuing") {
    super(message);
    this.name = "AuthenticationError";
  }
}

export async function requireUserId(): Promise<string> {
  const client = await createSupabaseServerClient();
  const result = await client.auth.getUser();
  if (result.error || !result.data.user) throw new AuthenticationError();
  return result.data.user.id;
}
