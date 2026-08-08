import { z } from "zod";

const KONTEXT_NEGATIVE_PROMPT = "text, watermark, duplicate person, same person twice, repeated character, extra face, montage, collage, split scene, close-up portrait, photorealistic face, photographic skin, pasted face, distorted face, unnatural anatomy";

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

export interface KontextIdentityInput {
  readonly prompt: string;
  readonly imageStoragePath: string;
  readonly seed: number;
}

export interface KontextOutput {
  readonly imageUrl: string;
  readonly cost: number | undefined;
}

export function buildKontextInput(input: KontextInput): Readonly<Record<string, unknown>> {
  return {
    ...kontextParameters(input.prompt, input.seed),
    image: requireHttpsUrl(input.imageUrl),
  };
}

export function buildKontextRequestIdentity(
  input: KontextIdentityInput,
): Readonly<Record<string, unknown>> {
  return {
    ...kontextParameters(input.prompt, input.seed),
    image_storage_path: z.string().trim().min(1).parse(input.imageStoragePath),
  };
}

export function normalizeKontextImageUrl(output: unknown): string {
  return normalizeKontextOutput(output).imageUrl;
}

export function normalizeKontextOutput(output: unknown): KontextOutput {
  const parsed = kontextOutputSchema.parse(output);
  if (parsed.image_url && parsed.result && parsed.image_url !== parsed.result) {
    throw new Error("Runpod Kontext returned conflicting image URLs");
  }
  const value = parsed.image_url ?? parsed.result;
  if (!value) {
    throw new Error("Runpod Kontext returned no image URL");
  }
  return { imageUrl: requireHttpsUrl(value), cost: parsed.cost };
}

function requireHttpsUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:") {
    throw new Error("Runpod image URL must use HTTPS");
  }
  return url.toString();
}

function kontextParameters(prompt: string, seed: number | undefined): Readonly<Record<string, unknown>> {
  return {
    prompt: z.string().trim().min(1).max(2_000).parse(prompt),
    negative_prompt: KONTEXT_NEGATIVE_PROMPT,
    seed: seed ?? -1,
    num_inference_steps: 28,
    guidance: 2,
    size: "1024*1024",
    output_format: "png",
    enable_safety_checker: true,
  };
}
