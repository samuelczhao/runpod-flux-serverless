import { describe, expect, it } from "vitest";
import {
  buildKontextInput,
  buildKontextRequestIdentity,
  normalizeKontextImageUrl,
  normalizeKontextOutput,
} from "@/lib/runpod/kontext";

describe("Kontext contract", () => {
  it.each(["image_url", "result"])("accepts the %s response field", (field) => {
    expect(normalizeKontextImageUrl({ [field]: "https://image.runpod.ai/result.png" })).toBe("https://image.runpod.ai/result.png");
  });

  it("rejects conflicting compatibility fields", () => {
    expect(() => normalizeKontextImageUrl({ image_url: "https://a.test/a.png", result: "https://b.test/b.png" })).toThrow("conflicting");
  });

  it("preserves the provider cost for exact accounting", () => {
    expect(normalizeKontextOutput({ image_url: "https://cdn.runpod.ai/a.png", cost: 0.025 })).toEqual({
      imageUrl: "https://cdn.runpod.ai/a.png",
      cost: 0.025,
    });
  });

  it("always enables the safety checker", () => {
    expect(buildKontextInput({ prompt: "Keep the traveler", imageUrl: "https://images.test/a.png" })).toMatchObject({
      enable_safety_checker: true, output_format: "png", size: "1024*1024",
    });
  });

  it("shares inference knobs with the stable request identity", () => {
    const request = buildKontextInput({ prompt: "Keep the traveler", imageUrl: "https://images.test/a.png", seed: 7 });
    const identity = buildKontextRequestIdentity({
      prompt: "Keep the traveler", imageStoragePath: "user/dream/parent.png", seed: 7,
    });
    expect(identity).toMatchObject({
      prompt: request.prompt, seed: request.seed, num_inference_steps: request.num_inference_steps,
      guidance: request.guidance, size: request.size, output_format: request.output_format,
      enable_safety_checker: request.enable_safety_checker,
    });
  });
});
