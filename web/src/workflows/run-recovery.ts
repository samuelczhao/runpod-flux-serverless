export type ExistingRunState =
  | "missing" | "pending" | "running" | "completed" | "failed" | "cancelled";

export function shouldReleaseWorkflow(state: ExistingRunState): boolean {
  return state === "missing" || state === "failed" || state === "cancelled";
}
