import { z } from "zod";

const kontextOutputSchema = z.object({
  image_url: z.string().optional(),
  result: z.string().optional(),
  cost: z.number().finite().nonnegative().optional(),
}).passthrough();

export interface KontextInput {
  readonly prompt: string;
  readonly imageUrl: string;
  readonly seed?: number;
}

export function buildKontextInput(input: KontextInput): Readonly<Record<string, unknown>> {
  return {
    prompt: z.string().trim().min(1).max(2_000).parse(input.prompt),
    image: requireHttpsUrl(input.imageUrl),
    negative_prompt: "text, watermark, duplicate subjects",
    seed: input.seed ?? -1,
    num_inference_steps: 28,
    guidance: 2,
    size: "1024*1024",
    output_format: "png",
    enable_safety_checker: true,
  };
}

export function normalizeKontextImageUrl(output: unknown): string {
  const parsed = kontextOutputSchema.parse(output);
  if (parsed.image_url && parsed.result && parsed.image_url !== parsed.result) {
    throw new Error("Runpod Kontext returned conflicting image URLs");
  }
  const value = parsed.image_url ?? parsed.result;
  if (!value) {
    throw new Error("Runpod Kontext returned no image URL");
  }
  return requireHttpsUrl(value);
}

function requireHttpsUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:") {
    throw new Error("Runpod image URL must use HTTPS");
  }
  return url.toString();
}
