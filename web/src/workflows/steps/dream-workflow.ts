import type { DreamStatus } from "@/lib/domain/dream";
import {
  getProcessingDream,
  recordDreamWorkflow,
  releaseDreamWorkflowExecution,
} from "@/lib/database/dreams";

export async function recordDreamWorkflowStep(
  dreamId: string,
  token: string,
  runId: string,
): Promise<void> {
  "use step";
  await recordDreamWorkflow(dreamId, token, runId);
}

export async function releaseDreamWorkflowExecutionStep(
  dreamId: string,
  token: string,
  runId: string,
): Promise<void> {
  "use step";
  await releaseDreamWorkflowExecution(dreamId, token, runId);
}

export async function getDreamWorkflowStatusStep(dreamId: string): Promise<DreamStatus> {
  "use step";
  return (await getProcessingDream(dreamId)).status;
}
