import { RunpodHttpError } from "@/lib/runpod/http";

export type SubmissionFailureStatus = "FAILED" | "SUBMIT_UNKNOWN";

export function classifySubmissionFailure(error: unknown): SubmissionFailureStatus {
  if (error instanceof RunpodHttpError && error.status >= 400 && error.status < 500) return "FAILED";
  return "SUBMIT_UNKNOWN";
}
