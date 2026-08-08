import { describe, expect, it } from "vitest";
import { branchRequestHash, branchRequestSchema, branchSeed } from "@/lib/domain/branch";

const request = {
  dreamId: "7cb64bba-181a-432b-9dc7-040585dfbb51",
  parentVersionId: "70ebbbf5-ac72-436b-9f61-18f2fa12d43d",
  instruction: "Turn the moon into a doorway",
  operationId: "5deefbe0-2003-4af4-b75e-0bd9c22bed60",
};
const provider = { endpointId: "kontext-endpoint", parentStoragePath: "user/dream/parent.png" };

describe("scene branch identity", () => {
  it("derives a deterministic seed and request hash", () => {
    const seed = branchSeed(request.operationId);
    expect(seed).toBe(branchSeed(request.operationId));
    expect(branchRequestHash(request, seed, provider)).toHaveLength(64);
  });

  it("binds the hash to the endpoint and stable parent artifact", () => {
    const seed = branchSeed(request.operationId);
    const hash = branchRequestHash(request, seed, provider);
    expect(branchRequestHash(request, seed, { ...provider, endpointId: "other" })).not.toBe(hash);
    expect(branchRequestHash(request, seed, { ...provider, parentStoragePath: "other.png" })).not.toBe(hash);
  });

  it("rejects vague edits and invalid operation IDs", () => {
    expect(() => branchRequestSchema.parse({ ...request, instruction: "x" })).toThrow();
    expect(() => branchRequestSchema.parse({ ...request, operationId: "retry-1" })).toThrow();
  });
});
