import { RunpodHttpError } from "@/lib/runpod/http";

export type SubmissionFailureStatus = "FAILED" | "SUBMIT_UNKNOWN";

export function classifySubmissionFailure(error: unknown): SubmissionFailureStatus {
  if (error instanceof RunpodHttpError && isDefiniteRejection(error.status)) return "FAILED";
  return "SUBMIT_UNKNOWN";
}

function isDefiniteRejection(status: number): boolean {
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}
