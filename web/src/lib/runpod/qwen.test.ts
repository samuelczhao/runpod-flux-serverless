import { describe, expect, it, vi } from "vitest";
import { createDreamPlan } from "@/lib/runpod/qwen";

describe("Qwen dream planner", () => {
  it("requests strict no-think output and validates the plan", async () => {
    const fetcher = vi.fn().mockResolvedValue(qwenResponse());
    const result = await createDreamPlan("I followed a train into the clouds.", "secret", fetcher);
    const request = JSON.parse(String(fetcher.mock.calls[0][1]?.body)) as Record<string, unknown>;
    expect(request).toMatchObject({ temperature: 0, chat_template_kwargs: { enable_thinking: false } });
    expect(JSON.stringify(request)).toContain("/no_think");
    expect(request.response_format).toMatchObject({ type: "json_schema", json_schema: { strict: true } });
    expect(result.costUsd).toBe("0.00272000");
  });

  it("rejects prose around JSON", async () => {
    const fetcher = vi.fn().mockResolvedValue(qwenResponse("```json\n{}\n```"));
    await expect(createDreamPlan("A train dream", "secret", fetcher)).rejects.toThrow();
  });
});

function qwenResponse(content: string = JSON.stringify(validPlan())): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { total_tokens: 272 } }), { status: 200 });
}

function validPlan(): Record<string, unknown> {
  const scene = { caption: "Cloud station", prompt: "A cloud station, indigo watercolor" };
  return { title: "Cloud Train", summary: "A train crosses the sky.", mood: ["wonder"], motifs: [{ label: "train", kind: "object" }], visual_bible: "Indigo watercolor, one red-coated traveler.", scenes: [scene, scene, scene] };
}
