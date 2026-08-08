import { describe, expect, it } from "vitest";
import { assertVersionModel } from "@/lib/domain/version";

describe("scene version model", () => {
  it("accepts an exact model replay", () => {
    expect(() => assertVersionModel({ model: "model-a" }, "model-a")).not.toThrow();
  });

  it("rejects a conflicting model replay", () => {
    expect(() => assertVersionModel({ model: "model-a" }, "model-b")).toThrow("model mismatch");
  });
});
