import type { ExistingRunState } from "@/workflows/run-recovery";

export function shouldReleaseAudioCleanup(state: ExistingRunState): boolean {
  return state === "missing" || state === "completed"
    || state === "failed" || state === "cancelled";
}
