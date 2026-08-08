import { describe, expect, it } from "vitest";
import { dreamPlanSchema } from "@/lib/domain/dream";

describe("dream plan contract", () => {
  it("accepts exactly three scenes", () => {
    const result = dreamPlanSchema.safeParse(validPlan());
    expect(result.success).toBe(true);
  });

  it("rejects a plan that omits the visual bible", () => {
    const plan = validPlan();
    delete plan.visual_bible;
    expect(dreamPlanSchema.safeParse(plan).success).toBe(false);
  });

  it("rejects model-invented fields", () => {
    expect(dreamPlanSchema.safeParse({ ...validPlan(), diagnosis: "prophecy" }).success).toBe(false);
  });

  it("rejects malformed and unsupported moods", () => {
    expect(dreamPlanSchema.safeParse({ ...validPlan(), mood: ["4"] }).success).toBe(false);
    expect(dreamPlanSchema.safeParse({ ...validPlan(), mood: ["w"] }).success).toBe(false);
    expect(dreamPlanSchema.safeParse({ ...validPlan(), mood: ["sleepy"] }).success).toBe(false);
  });

  it("limits the planner to three presentation-friendly moods", () => {
    const moods = ["wonder", "calm", "awe", "mystery"];
    expect(dreamPlanSchema.safeParse({ ...validPlan(), mood: moods }).success).toBe(false);
  });
});

function validPlan(): Record<string, unknown> {
  const scene = { caption: "A moonlit station", prompt: "A moonlit station in watercolor" };
  return {
    title: "The Last Train",
    summary: "A traveler follows a silent train through the clouds.",
    mood: ["wonder", "uncertainty"],
    motifs: [{ label: "train", kind: "object" }],
    visual_bible: "Indigo watercolor, one red-coated traveler, soft moonlight.",
    scenes: [scene, scene, scene],
  };
}
