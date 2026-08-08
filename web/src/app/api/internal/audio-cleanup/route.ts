import { getMaintenanceEnv } from "@/lib/config/env";
import {
  getExpiredAudioCleanupCandidates,
  type AudioCleanupCandidate,
} from "@/lib/database/dreams";
import { startAudioCleanup } from "@/workflows/start-audio-cleanup";
import { cleanupIdentityCandidates } from "@/lib/database/identity";

const SWEEP_LIMIT = 50;

export async function GET(request: Request): Promise<Response> {
  try {
    requireCronRequest(request);
    const candidates = await getExpiredAudioCleanupCandidates(SWEEP_LIMIT);
    const [audioResults, identity] = await Promise.all([
      Promise.allSettled(candidates.map(startCandidate)),
      cleanupIdentityCandidates(SWEEP_LIMIT),
    ]);
    const audioFailed = audioResults.filter((result) => result.status === "rejected").length;
    const failed = audioFailed + identity.failed;
    const inspected = candidates.length + identity.inspected;
    return Response.json({ inspected, failed }, { status: failed ? 503 : 200 });
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
