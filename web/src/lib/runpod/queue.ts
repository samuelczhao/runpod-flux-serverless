import { z } from "zod";
import { bearerHeaders, readJson, type FetchLike } from "@/lib/runpod/http";

const API_BASE = "https://api.runpod.ai/v2";
const endpointIdSchema = z.string().regex(/^[A-Za-z0-9_-]+$/);

export const queueStatusSchema = z.enum([
  "IN_QUEUE",
  "IN_PROGRESS",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "TIMED_OUT",
]);

const submissionSchema = z.object({
  id: z.string().min(1),
  status: queueStatusSchema.optional(),
}).passthrough();

const statusSchema = z.object({
  id: z.string().min(1),
  status: queueStatusSchema,
  output: z.unknown().optional(),
  error: z.unknown().optional(),
  delayTime: z.number().int().nonnegative().optional(),
  executionTime: z.number().int().nonnegative().optional(),
}).passthrough();

export type QueueStatus = z.infer<typeof statusSchema>;

export async function submitQueueJob(
  endpointId: string,
  input: Readonly<Record<string, unknown>>,
  apiKey: string,
  fetcher: FetchLike = fetch,
): Promise<string> {
  const response = await fetcher(queueUrl(endpointId, "run"), postOptions(apiKey, input));
  return submissionSchema.parse(await readJson(response)).id;
}

export async function getQueueStatus(
  endpointId: string,
  jobId: string,
  apiKey: string,
  fetcher: FetchLike = fetch,
): Promise<QueueStatus> {
  const safeJobId = encodeURIComponent(z.string().min(1).parse(jobId));
  const response = await fetcher(queueUrl(endpointId, `status/${safeJobId}`), { headers: bearerHeaders(apiKey) });
  return statusSchema.parse(await readJson(response));
}

function queueUrl(endpointId: string, route: string): string {
  return `${API_BASE}/${endpointIdSchema.parse(endpointId)}/${route}`;
}

function postOptions(apiKey: string, input: Readonly<Record<string, unknown>>): RequestInit {
  return { method: "POST", headers: bearerHeaders(apiKey), body: JSON.stringify({ input }) };
}
