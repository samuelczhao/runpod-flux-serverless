import { z } from "zod";
import { hashJson, sha256 } from "@/lib/database/hash";
import { buildKontextRequestIdentity } from "@/lib/runpod/kontext";

export const KONTEXT_MODEL = "black-forest-labs/FLUX.1-Kontext-dev";

export const branchRequestSchema = z.object({
  dreamId: z.uuid(),
  parentVersionId: z.uuid(),
  instruction: z.string().trim().min(3).max(1_000),
  operationId: z.uuid(),
}).strict();

export type BranchRequest = z.infer<typeof branchRequestSchema>;
export type BranchHashRequest = Pick<BranchRequest, "parentVersionId" | "instruction">;

export interface BranchProviderIdentity {
  readonly endpointId: string;
  readonly parentStoragePath: string;
}

export function branchSeed(operationId: string): number {
  return Number.parseInt(sha256(z.uuid().parse(operationId)).slice(0, 8), 16);
}

export function branchRequestHash(
  input: BranchHashRequest,
  seed: number,
  provider: BranchProviderIdentity,
): string {
  return hashJson({
    endpointId: provider.endpointId, model: KONTEXT_MODEL,
    parentVersionId: input.parentVersionId, version: "branch-v2",
    input: buildKontextRequestIdentity({
      prompt: branchEditPrompt(input.instruction),
      imageStoragePath: provider.parentStoragePath,
      seed,
    }),
  });
}

export function branchEditPrompt(instruction: string): string {
  return `Make this change: ${instruction}. Preserve the subject, composition, lighting, and visual identity.`;
}
