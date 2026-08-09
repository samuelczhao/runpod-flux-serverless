import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";

const MAX_COOKIE_BYTES = 3_180;
const MAX_READ_ATTEMPTS = 3;
const READ_RETRY_DELAY_MS = 250;
const TRANSIENT_NETWORK_CODES = new Set([
  "EAI_AGAIN", "ECONNRESET", "ENETUNREACH", "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET",
]);

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
  const attempts = isReadRequest(init) ? MAX_READ_ATTEMPTS : 1;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetchJson(url, init);
    } catch (error) {
      if (!shouldRetry(error, attempt, attempts)) throw error;
      await delay(READ_RETRY_DELAY_MS * attempt);
    }
  }
  throw new Error("Request attempts exhausted");
}

async function fetchJson(url: string, init: RequestInit): Promise<unknown> {
  const response = await fetch(url, init);
  if (response.ok) return response.json() as Promise<unknown>;
  const detail = (await response.text()).slice(0, 300);
  throw new Error(`Request failed with HTTP ${response.status}: ${detail}`);
}

function isReadRequest(init: RequestInit): boolean {
  return (init.method ?? "GET").toUpperCase() === "GET";
}

function shouldRetry(error: unknown, attempt: number, attempts: number): boolean {
  if (attempt >= attempts || !(error instanceof TypeError)) return false;
  const cause = error.cause;
  if (!cause || typeof cause !== "object" || !("code" in cause)) return false;
  return typeof cause.code === "string" && TRANSIENT_NETWORK_CODES.has(cause.code);
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
