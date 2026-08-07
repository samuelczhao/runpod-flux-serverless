import { failDream, finalizeDream } from "@/lib/database/dreams";

export async function finalizeDreamStep(dreamId: string): Promise<void> {
  "use step";
  await finalizeDream(dreamId);
}

export async function failDreamStep(dreamId: string): Promise<void> {
  "use step";
  await failDream(dreamId, "generation", "WORKFLOW_FAILED");
}
