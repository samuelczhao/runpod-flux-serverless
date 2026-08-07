import { z } from "zod";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const anchorOutputSchema = z.object({
  image_base64: z.string().min(1),
  mime_type: z.literal("image/png"),
  seed: z.number().int().nonnegative(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
}).passthrough();

export interface AnchorInput {
  readonly prompt: string;
  readonly seed: number;
  readonly width?: number;
  readonly height?: number;
  readonly numInferenceSteps?: number;
}

export function buildAnchorInput(input: AnchorInput): Readonly<Record<string, unknown>> {
  return {
    prompt: z.string().trim().min(1).max(2_000).parse(input.prompt),
    seed: z.number().int().nonnegative().parse(input.seed),
    width: input.width ?? 1024,
    height: input.height ?? 1024,
    num_inference_steps: input.numInferenceSteps ?? 50,
    guidance_scale: 3.5,
  };
}

export function decodeAnchorPng(output: unknown): Buffer {
  const parsed = anchorOutputSchema.parse(output);
  const bytes = Buffer.from(parsed.image_base64, "base64");
  assertCanonicalBase64(parsed.image_base64, bytes);
  if (!bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error("Runpod anchor output is not a PNG");
  }
  return bytes;
}

function assertCanonicalBase64(encoded: string, bytes: Buffer): void {
  const normalized = encoded.replace(/=+$/, "");
  if (bytes.toString("base64").replace(/=+$/, "") !== normalized) {
    throw new Error("Runpod anchor output contains invalid base64");
  }
}
