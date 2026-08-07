import { describe, expect, it } from "vitest";
import { assertTransition, canTransition } from "@/lib/domain/state-machine";

describe("dream state machine", () => {
  it("allows the typed-input happy path", () => {
    expect(canTransition("DRAFT", "PLANNING")).toBe(true);
    expect(canTransition("PLANNING", "GENERATING_ANCHOR")).toBe(true);
    expect(canTransition("GENERATING_SCENES", "READY")).toBe(true);
  });

  it("rejects skipping expensive stages", () => {
    expect(() => assertTransition("DRAFT", "READY")).toThrow("Invalid dream transition");
  });

  it("keeps failures terminal until the dream is deleted", () => {
    expect(canTransition("FAILED", "GENERATING_SCENES")).toBe(false);
    expect(canTransition("FAILED", "DELETING")).toBe(true);
  });
});
