import type { ExistingRunState } from "@/workflows/branch-recovery";

export function shouldReleaseAudioCleanup(state: ExistingRunState): boolean {
  return state === "missing" || state === "completed"
    || state === "failed" || state === "cancelled";
}
