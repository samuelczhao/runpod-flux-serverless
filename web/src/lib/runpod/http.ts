import { z } from "zod";

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class RunpodHttpError extends Error {
  public readonly status: number;

  public constructor(status: number) {
    super(`Runpod request failed with HTTP ${status}`);
    this.name = "RunpodHttpError";
    this.status = status;
  }
}

export async function readJson(response: Response): Promise<unknown> {
  if (!response.ok) {
    throw new RunpodHttpError(response.status);
  }
  const text = await response.text();
  try {
    return JSON.parse(text) as unknown;
  } catch (error: unknown) {
    throw new Error("Runpod returned invalid JSON", { cause: error });
  }
}

export function bearerHeaders(apiKey: string): Readonly<Record<string, string>> {
  z.string().min(1).parse(apiKey);
  return { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
}
