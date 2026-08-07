import { describe, expect, it } from "vitest";
import { hashJson, sha256 } from "@/lib/database/hash";

describe("database request hashes", () => {
  it("creates lowercase SHA-256 hashes", () => {
    expect(sha256("dream")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("distinguishes different paid requests", () => {
    expect(hashJson({ prompt: "moon" })).not.toBe(hashJson({ prompt: "forest" }));
  });
});
