import { z } from "zod";

const MAX_COOKIE_BYTES = 3_180;

export interface LiveAppContext {
  readonly baseUrl: string;
  readonly cookie: string;
}

export interface LivePublicEnv {
  readonly baseUrl: string;
  readonly supabaseUrl: string;
  readonly publishableKey: string;
}

export async function createLiveContext(env: LivePublicEnv): Promise<LiveAppContext> {
  const session = await requestJson(`${env.supabaseUrl}/auth/v1/signup`, {
    method: "POST",
    headers: { apikey: env.publishableKey, "Content-Type": "application/json" },
    body: JSON.stringify({ data: {} }),
  });
  return { baseUrl: env.baseUrl.replace(/\/$/, ""), cookie: sessionCookie(env.supabaseUrl, session) };
}

export function appRequest(
  context: LiveAppContext,
  path: string,
  init: RequestInit = {},
): Promise<unknown> {
  return requestJson(`${context.baseUrl}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Cookie: context.cookie, ...init.headers },
  });
}

export async function requestJson(url: string, init: RequestInit): Promise<unknown> {
  const response = await fetch(url, init);
  if (response.ok) return response.json() as Promise<unknown>;
  const detail = (await response.text()).slice(0, 300);
  throw new Error(`Request failed with HTTP ${response.status}: ${detail}`);
}

function sessionCookie(supabaseUrl: string, value: unknown): string {
  const session = z.object({
    access_token: z.string(),
    refresh_token: z.string(),
    user: z.object({ id: z.uuid() }),
  }).passthrough().parse(value);
  const encoded = `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
  if (encoded.length > MAX_COOKIE_BYTES) throw new Error("Supabase session requires chunked cookies");
  const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
  return `sb-${projectRef}-auth-token=${encoded}`;
}
