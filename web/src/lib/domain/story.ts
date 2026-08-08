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
  scenes: z.array(storySceneSchema).max(MAX_STORY_SCENES),
}).strict();

export type DreamStory = z.infer<typeof dreamStorySchema>;
export type StoryScene = z.infer<typeof storySceneSchema>;
export type StoryVersion = z.infer<typeof storyVersionSchema>;

const ACTIVE_VERSION_STATUSES = new Set<StoryVersion["status"]>([
  "PENDING", "SUBMITTING", "SUBMIT_UNKNOWN", "QUEUED", "RUNNING",
]);

export function shouldPollDream(story: DreamStory): boolean {
  if (story.status === "FAILED") return false;
  if (story.status !== "READY") return true;
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
  return { ...next, scenes };
}
