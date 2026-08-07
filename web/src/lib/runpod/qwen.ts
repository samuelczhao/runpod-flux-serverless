import { z } from "zod";
import { qwenCostUsd } from "@/lib/domain/cost";
import { dreamPlanSchema, type DreamPlan } from "@/lib/domain/dream";
import { bearerHeaders, readJson, type FetchLike } from "@/lib/runpod/http";

const QWEN_URL = "https://api.runpod.ai/v2/qwen3-32b-awq/openai/v1/chat/completions";
const QWEN_MODEL = "Qwen/Qwen3-32B-AWQ";
const MAX_TRANSCRIPT_LENGTH = 12_000;

const qwenResponseSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string().min(1) }).passthrough() }).passthrough()).length(1),
  usage: z.object({ total_tokens: z.number().int().nonnegative() }).passthrough(),
}).passthrough();

export interface DreamPlanResult {
  readonly plan: DreamPlan;
  readonly tokenCount: number;
  readonly costUsd: string;
}

export async function createDreamPlan(
  transcript: string,
  apiKey: string,
  fetcher: FetchLike = fetch,
): Promise<DreamPlanResult> {
  const response = await fetcher(QWEN_URL, requestOptions(transcript, apiKey));
  const parsed = qwenResponseSchema.parse(await readJson(response));
  const plan = dreamPlanSchema.parse(JSON.parse(parsed.choices[0].message.content) as unknown);
  return { plan, tokenCount: parsed.usage.total_tokens, costUsd: qwenCostUsd(parsed.usage.total_tokens) };
}

function requestOptions(transcript: string, apiKey: string): RequestInit {
  return {
    method: "POST",
    headers: bearerHeaders(apiKey),
    body: JSON.stringify(qwenRequest(transcript)),
  };
}

function qwenRequest(transcript: string): Readonly<Record<string, unknown>> {
  return {
    model: QWEN_MODEL,
    temperature: 0,
    max_tokens: 1_600,
    chat_template_kwargs: { enable_thinking: false },
    messages: dreamMessages(transcript),
    response_format: dreamResponseFormat(),
  };
}

function dreamMessages(transcript: string): readonly Readonly<Record<string, string>>[] {
  const dream = z.string().trim().min(1).max(MAX_TRANSCRIPT_LENGTH).parse(transcript);
  return [
    { role: "system", content: "Reconstruct dreams as visual stories. Extract only what is present. Never diagnose or interpret mental health." },
    { role: "user", content: `${dream}\n\nCreate three visually coherent scenes. /no_think` },
  ];
}

function dreamResponseFormat(): Readonly<Record<string, unknown>> {
  return {
    type: "json_schema",
    json_schema: { name: "dream_plan", strict: true, schema: z.toJSONSchema(dreamPlanSchema) },
  };
}
