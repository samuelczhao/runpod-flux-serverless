import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { appRequest, createLiveContext, type LiveAppContext } from "./live-smoke-context.ts";

const POLL_INTERVAL_MS = 3_000;
const DREAM_TIMEOUT_MS = 45 * 60 * 1_000;
const BRANCH_TIMEOUT_MS = 15 * 60 * 1_000;

const envSchema = z.object({
  DREAMTRACE_DEMO_SEED: z.literal("1"),
  DREAMTRACE_BASE_URL: z.url().default("http://localhost:3000"),
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
});
const createSchema = z.object({ dreamId: z.uuid(), runId: z.string().min(1) }).strict();
const versionSchema = z.object({
  id: z.uuid(), status: z.string(), isSelected: z.boolean(), imageUrl: z.url().nullable(),
}).passthrough();
const sceneSchema = z.object({
  id: z.uuid(), ordinal: z.number().int(), versionId: z.uuid().nullable(),
  versions: z.array(versionSchema),
}).passthrough();
const storySchema = z.object({
  id: z.uuid(), status: z.string(), failedStage: z.string().nullable(),
  errorCode: z.string().nullable(), scenes: z.array(sceneSchema),
}).passthrough();
const branchSchema = z.object({ versionId: z.uuid(), runId: z.string().nullable() }).strict();

type Story = z.infer<typeof storySchema>;

async function main(): Promise<void> {
  const env = envSchema.parse(process.env);
  const context = await createLiveContext({
    baseUrl: env.DREAMTRACE_BASE_URL,
    supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL,
    publishableKey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
  const first = await createDream(context, FIRST_DREAM);
  const firstStory = await waitForDream(context, first.dreamId, "dream_one");
  const branchId = await branchSecondScene(context, firstStory);
  const second = await createDream(context, SECOND_DREAM);
  await waitForDream(context, second.dreamId, "dream_two");
  console.log(`demo_ready dream_one=${first.dreamId} dream_two=${second.dreamId} branch=${branchId}`);
}

async function createDream(context: LiveAppContext, transcript: string) {
  const payload = await appRequest(context, "/api/dreams", {
    method: "POST", body: JSON.stringify({ transcript }),
  });
  const created = createSchema.parse(payload);
  console.log(`dream_started id=${created.dreamId} run=${created.runId}`);
  return created;
}

async function waitForDream(context: LiveAppContext, dreamId: string, label: string): Promise<Story> {
  let previous = "";
  const deadline = Date.now() + DREAM_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const story = storySchema.parse(await appRequest(context, `/api/dreams/${dreamId}`));
    if (story.status !== previous) console.log(`${label} status=${story.status}`);
    previous = story.status;
    if (story.status === "READY") return assertReadyStory(story);
    if (story.status === "FAILED") throw new Error(`${label} failed at ${story.failedStage}:${story.errorCode}`);
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error(`${label} timed out`);
}

async function branchSecondScene(context: LiveAppContext, story: Story): Promise<string> {
  const scene = story.scenes.find((candidate) => candidate.ordinal === 2);
  if (!scene?.versionId) throw new Error("Second scene has no selected version");
  const request = branchRequest(story.id, scene.versionId);
  const branch = await startBranchTwice(context, scene.id, request);
  console.log(`branch_started id=${branch.versionId} run=${branch.runId}`);
  await waitForBranch(context, story.id, branch.versionId);
  await selectBranch(context, scene.id, scene.versionId, branch.versionId);
  await assertBranchSelected(context, story.id, scene.id, branch.versionId);
  return branch.versionId;
}

async function startBranchTwice(
  context: LiveAppContext,
  sceneId: string,
  request: Readonly<Record<string, string>>,
): Promise<z.infer<typeof branchSchema>> {
  const payload = await appRequest(context, `/api/scenes/${sceneId}/branches`, {
    method: "POST", body: JSON.stringify(request),
  });
  const branch = branchSchema.parse(payload);
  const replay = branchSchema.parse(await appRequest(context, `/api/scenes/${sceneId}/branches`, {
    method: "POST", body: JSON.stringify(request),
  }));
  if (replay.versionId !== branch.versionId) throw new Error("Branch replay created a duplicate version");
  return branch;
}

async function waitForBranch(context: LiveAppContext, dreamId: string, versionId: string): Promise<void> {
  const deadline = Date.now() + BRANCH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const story = storySchema.parse(await appRequest(context, `/api/dreams/${dreamId}`));
    const branch = story.scenes.flatMap((scene) => scene.versions).find((version) => version.id === versionId);
    if (branch?.status === "COMPLETED") return console.log("branch status=COMPLETED");
    if (branch && ["FAILED", "CANCELLED", "SUBMIT_UNKNOWN"].includes(branch.status)) {
      throw new Error(`branch failed with ${branch.status}`);
    }
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error("branch timed out");
}

async function selectBranch(
  context: LiveAppContext,
  sceneId: string,
  expectedVersionId: string,
  nextVersionId: string,
): Promise<void> {
  await appRequest(context, `/api/scenes/${sceneId}/selection`, {
    method: "POST", body: JSON.stringify({ expectedVersionId, nextVersionId }),
  });
  await appRequest(context, `/api/scenes/${sceneId}/selection`, {
    method: "POST", body: JSON.stringify({ expectedVersionId, nextVersionId }),
  });
  console.log(`branch_selected id=${nextVersionId}`);
}

function branchRequest(dreamId: string, parentVersionId: string): Readonly<Record<string, string>> {
  return {
    dreamId, parentVersionId, operationId: crypto.randomUUID(),
    instruction: "Make the conductor an unmistakable red fox with a long muzzle and a large bushy tail. Keep the train, brass key, composition, lighting, and violet-night style unchanged.",
  };
}

function assertReadyStory(story: Story): Story {
  const ordinals = story.scenes.map((scene) => scene.ordinal).sort();
  if (ordinals.join(",") !== "1,2,3") throw new Error("READY dream does not have exactly three scenes");
  for (const scene of story.scenes) {
    const selected = scene.versions.filter((version) => version.isSelected);
    if (selected.length !== 1 || selected[0].status !== "COMPLETED" || !selected[0].imageUrl) {
      throw new Error(`READY scene ${scene.ordinal} has no selected completed image`);
    }
  }
  return story;
}

async function assertBranchSelected(
  context: LiveAppContext,
  dreamId: string,
  sceneId: string,
  versionId: string,
): Promise<void> {
  const story = assertReadyStory(storySchema.parse(await appRequest(context, `/api/dreams/${dreamId}`)));
  const scene = story.scenes.find((candidate) => candidate.id === sceneId);
  const selected = scene?.versions.find((version) => version.isSelected);
  if (selected?.id !== versionId) throw new Error("Selected branch did not persist");
}

const FIRST_DREAM = "I rode a silver train toward a moonlit lake while a red fox conductor guarded a brass key. At the shore the brass key opened a glass observatory, and inside the red fox pointed to a silver train circling the moon like a constellation.";
const SECOND_DREAM = "I found the same brass key beneath a moonlit lake and followed a red fox onto a silver train. The silver train carried us to a quiet library where floating lanterns formed a constellation and the brass key became a small moon.";

await main();
