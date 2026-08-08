import { describe, expect, it } from "vitest";
import { buildAnchorInput, decodeAnchorPng } from "@/lib/runpod/anchor";

const PNG_BYTES = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]);

describe("custom FLUX anchor contract", () => {
  it("builds the deployed worker input", () => {
    expect(buildAnchorInput({ prompt: " moon station ", seed: 42 })).toMatchObject({
      prompt: "moon station", seed: 42, width: 1024, height: 1024, num_inference_steps: 50,
    });
  });

  it("decodes a validated PNG", () => {
    const output = { image_base64: PNG_BYTES.toString("base64"), mime_type: "image/png", seed: 42, width: 1024, height: 1024 };
    expect(decodeAnchorPng(output)).toEqual(PNG_BYTES);
  });

  it("rejects a non-PNG payload", () => {
    const output = { image_base64: Buffer.from("text").toString("base64"), mime_type: "image/png", seed: 1, width: 1024, height: 1024 };
    expect(() => decodeAnchorPng(output)).toThrow("not a PNG");
  });
});
