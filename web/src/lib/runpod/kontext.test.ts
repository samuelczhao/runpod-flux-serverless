import { describe, expect, it } from "vitest";
import { buildKontextInput, normalizeKontextImageUrl } from "@/lib/runpod/kontext";

describe("Kontext contract", () => {
  it.each(["image_url", "result"])("accepts the %s response field", (field) => {
    expect(normalizeKontextImageUrl({ [field]: "https://image.runpod.ai/result.png" })).toBe("https://image.runpod.ai/result.png");
  });

  it("rejects conflicting compatibility fields", () => {
    expect(() => normalizeKontextImageUrl({ image_url: "https://a.test/a.png", result: "https://b.test/b.png" })).toThrow("conflicting");
  });

  it("always enables the safety checker", () => {
    expect(buildKontextInput({ prompt: "Keep the traveler", imageUrl: "https://images.test/a.png" })).toMatchObject({
      enable_safety_checker: true, output_format: "png", size: "1024*1024",
    });
  });
});
