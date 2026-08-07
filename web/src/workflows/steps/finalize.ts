import { failDream, finalizeDream } from "@/lib/database/dreams";

export async function finalizeDreamStep(dreamId: string): Promise<void> {
  "use step";
  await finalizeDream(dreamId);
}

export async function failDreamStep(dreamId: string, stage = "generation"): Promise<void> {
  "use step";
  await failDream(dreamId, stage, "WORKFLOW_FAILED");
}
