import { getRunpodEnv } from "@/lib/config/env";
import { completeDreamPlan, getProcessingDream } from "@/lib/database/dreams";
import { hashJson, sha256 } from "@/lib/database/hash";
import { claimGenerationJob, transitionGenerationJob, type JobClaim } from "@/lib/database/jobs";
import { createDreamPlan, type DreamPlanResult } from "@/lib/runpod/qwen";
import { recordSubmissionFailure } from "@/lib/runpod/submission";

const PLAN_MODEL = "Qwen/Qwen3-32B-AWQ";

export async function planDreamStep(dreamId: string): Promise<void> {
  "use step";
  const dream = await getProcessingDream(dreamId);
  if (dream.status === "GENERATING_ANCHOR" && dream.plan_hash) return;
  if (dream.status !== "PLANNING" || !dream.transcript) throw new Error("Dream is not ready for planning");
  const claim = await claimPlanJob(dream.id, dream.user_id, dream.transcript);
  if (!claim.claimed) return resumePlanClaim(claim, dream.plan_hash);
  const result = await requestPlan(claim.jobId, dream.transcript);
  const planHash = hashJson(result.plan);
  await completeDreamPlan(claim.jobId, result.plan, planHash, result.costUsd);
}

async function claimPlanJob(dreamId: string, userId: string, transcript: string): Promise<JobClaim> {
  return claimGenerationJob({
    userId, dreamId, sceneVersionId: null, stage: "plan",
    operationKey: `${dreamId}:plan:v1`, model: PLAN_MODEL,
    requestHash: sha256(`dream-plan-v1:${transcript}`),
  });
}

async function requestPlan(jobId: string, transcript: string): Promise<DreamPlanResult> {
  try {
    return await createDreamPlan(transcript, getRunpodEnv().apiKey);
  } catch (error: unknown) {
    await recordSubmissionFailure(jobId, error);
    throw error;
  }
}

async function resumePlanClaim(claim: JobClaim, planHash: string | null): Promise<void> {
  if (claim.status === "COMPLETED" && planHash) return;
  if (claim.status === "SUBMITTING") {
    await transitionGenerationJob(claim.jobId, "SUBMITTING", "SUBMIT_UNKNOWN", {
      p_error_code: "PLANNING_RESPONSE_LOST",
    });
  }
  throw new Error("Planning submission cannot be safely repeated");
}
