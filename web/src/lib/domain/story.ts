import { z } from "zod";
import { dreamStatusSchema, MAX_STORY_SCENES } from "@/lib/domain/dream";
import { jobStatusSchema } from "@/lib/database/schemas";

export const storyVersionSchema = z.object({
  id: z.uuid(),
  parentVersionId: z.uuid().nullable(),
  editInstruction: z.string().nullable(),
  status: jobStatusSchema,
  isSelected: z.boolean(),
  imageUrl: z.url().nullable(),
}).strict();

export const storySceneSchema = z.object({
  id: z.uuid(),
  ordinal: z.number().int().min(1).max(MAX_STORY_SCENES),
  caption: z.string(),
  versionId: z.uuid().nullable(),
  imageUrl: z.url().nullable(),
  versions: z.array(storyVersionSchema),
}).strict();

export const dreamStorySchema = z.object({
  id: z.uuid(),
  status: dreamStatusSchema,
  inputMode: z.enum(["audio", "text"]),
  transcript: z.string().nullable(),
  awaitingTranscriptReview: z.boolean(),
  title: z.string().nullable(),
  summary: z.string().nullable(),
  mood: z.array(z.string()),
  failedStage: z.string().nullable(),
  errorCode: z.string().nullable(),
  imageUrlsIssuedAt: z.iso.datetime({ offset: true }),
  scenes: z.array(storySceneSchema).max(MAX_STORY_SCENES),
}).strict();

export type DreamStory = z.infer<typeof dreamStorySchema>;
export type StoryScene = z.infer<typeof storySceneSchema>;
export type StoryVersion = z.infer<typeof storyVersionSchema>;

const ACTIVE_VERSION_STATUSES = new Set<StoryVersion["status"]>([
  "PENDING", "SUBMITTING", "QUEUED", "RUNNING",
]);
export const STORY_IMAGE_URL_TTL_SECONDS = 3_600;
const ACTIVE_STORY_POLL_INTERVAL_MS = 3_000;
const STORY_IMAGE_URL_REFRESH_BUFFER_SECONDS = 600;
const STORY_IMAGE_URL_REFRESH_AGE_MS = (
  STORY_IMAGE_URL_TTL_SECONDS - STORY_IMAGE_URL_REFRESH_BUFFER_SECONDS
) * 1_000;

export interface DreamPollPlan {
  readonly delayMs: number;
  readonly preserveImageUrls: boolean;
}

export function planDreamPoll(
  story: DreamStory,
  nowMs: number = Date.now(),
): DreamPollPlan | null {
  if (story.status === "FAILED") return null;
  if (story.status !== "READY" || hasActiveVersion(story)) {
    return { delayMs: ACTIVE_STORY_POLL_INTERVAL_MS, preserveImageUrls: true };
  }
  if (!story.scenes.some((scene) => scene.imageUrl)) return null;
  const issuedAtMs = Date.parse(story.imageUrlsIssuedAt);
  const delayMs = Math.max(0, issuedAtMs + STORY_IMAGE_URL_REFRESH_AGE_MS - nowMs);
  return { delayMs, preserveImageUrls: false };
}

function hasActiveVersion(story: DreamStory): boolean {
  return story.scenes.some((scene) => scene.versions.some(
    (version) => ACTIVE_VERSION_STATUSES.has(version.status),
  ));
}

export function preserveStoryImageUrls(
  current: DreamStory | null,
  next: DreamStory,
): DreamStory {
  if (!current || current.id !== next.id) return next;
  const urls = new Map(current.scenes.flatMap((scene) => scene.versions
    .filter((version) => version.imageUrl)
    .map((version) => [version.id, version.imageUrl] as const)));
  const scenes = next.scenes.map((scene) => {
    const versions = scene.versions.map((version) => ({
      ...version,
      imageUrl: urls.get(version.id) ?? version.imageUrl,
    }));
    const selected = versions.find((version) => version.id === scene.versionId);
    return { ...scene, versions, imageUrl: selected?.imageUrl ?? scene.imageUrl };
  });
  const imageUrlsIssuedAt = urls.size > 0 ? current.imageUrlsIssuedAt : next.imageUrlsIssuedAt;
  return { ...next, imageUrlsIssuedAt, scenes };
}

export function mergeStoryPollResult(
  current: DreamStory | null,
  next: DreamStory,
  preserveImageUrls: boolean,
  nowMs: number = Date.now(),
): DreamStory {
  if (!preserveImageUrls || crossedImageRenewalBoundary(current, next)
    || imageUrlsNeedRenewal(current, nowMs)) return next;
  return preserveStoryImageUrls(current, next);
}

function imageUrlsNeedRenewal(story: DreamStory | null, nowMs: number): boolean {
  if (!story || !story.scenes.some((scene) => scene.imageUrl)) return false;
  return Date.parse(story.imageUrlsIssuedAt) + STORY_IMAGE_URL_REFRESH_AGE_MS <= nowMs;
}

function crossedImageRenewalBoundary(current: DreamStory | null, next: DreamStory): boolean {
  if (!current || current.id !== next.id) return false;
  if (current.status !== "READY" && next.status === "READY") return true;
  return current.status === "READY" && next.status === "READY"
    && hasActiveVersion(current) && !hasActiveVersion(next);
}
