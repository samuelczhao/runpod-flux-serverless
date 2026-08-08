import {
  recordBranchWorkflow,
  releaseBranchWorkflowExecution,
} from "@/lib/database/scenes";

export async function recordBranchWorkflowStep(
  versionId: string,
  token: string,
  runId: string,
): Promise<void> {
  "use step";
  await recordBranchWorkflow(versionId, token, runId);
}

export async function releaseBranchWorkflowExecutionStep(
  versionId: string,
  token: string,
  runId: string,
): Promise<void> {
  "use step";
  await releaseBranchWorkflowExecution(versionId, token, runId);
}
