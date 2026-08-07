import { transitionGenerationJob } from "@/lib/database/jobs";
import { classifySubmissionFailure } from "@/lib/runpod/submission-policy";

export async function recordSubmissionFailure(jobId: string, error: unknown): Promise<void> {
  const next = classifySubmissionFailure(error);
  await transitionGenerationJob(jobId, "SUBMITTING", next, {
    p_error_code: next === "FAILED" ? "PROVIDER_REJECTED" : "SUBMISSION_AMBIGUOUS",
  });
}
