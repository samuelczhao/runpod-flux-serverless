import { getMaintenanceEnv } from "@/lib/config/env";
import {
  getExpiredAudioCleanupCandidates,
  type AudioCleanupCandidate,
} from "@/lib/database/dreams";
import { startAudioCleanup } from "@/workflows/start-audio-cleanup";
import { cleanupIdentityCandidates } from "@/lib/database/identity";

const AUDIO_SWEEP_LIMIT = 100;
const IDENTITY_SWEEP_LIMIT = 250;

export async function GET(request: Request): Promise<Response> {
  try {
    requireCronRequest(request);
    const candidates = await getExpiredAudioCleanupCandidates(AUDIO_SWEEP_LIMIT);
    const [audioResults, identity] = await Promise.all([
      Promise.allSettled(candidates.map(startCandidate)),
      cleanupIdentityCandidates(IDENTITY_SWEEP_LIMIT),
    ]);
    const audioFailed = audioResults.filter((result) => result.status === "rejected").length;
    const failed = audioFailed + identity.failed;
    const inspected = candidates.length + identity.inspected;
    const status = failed || identity.remaining ? 503 : 200;
    return Response.json({
      inspected,
      failed,
      identityBacklog: identity.remaining,
      oldestIdentityDueAt: identity.oldestDueAt,
    }, { status });
  } catch (error: unknown) {
    const status = error instanceof CronAuthenticationError ? 401 : 500;
    return Response.json({ error: status === 401 ? "Unauthorized" : "Cleanup sweep failed" }, { status });
  }
}

function requireCronRequest(request: Request): void {
  const expected = `Bearer ${getMaintenanceEnv().cronSecret}`;
  if (request.headers.get("authorization") !== expected) throw new CronAuthenticationError();
}

async function startCandidate(candidate: AudioCleanupCandidate): Promise<void> {
  await startAudioCleanup(candidate.dreamId, candidate.userId);
}

class CronAuthenticationError extends Error {}
