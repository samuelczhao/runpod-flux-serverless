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
