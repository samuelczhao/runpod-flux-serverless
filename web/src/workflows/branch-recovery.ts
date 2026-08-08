export type ExistingRunState =
  | "missing" | "pending" | "running" | "completed" | "failed" | "cancelled";

export function shouldReleaseBranchWorkflow(state: ExistingRunState): boolean {
  return state === "missing" || state === "failed" || state === "cancelled";
}
