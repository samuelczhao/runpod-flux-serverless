import { z } from "zod";
import { dreamStatusSchema } from "@/lib/domain/dream";
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
  ordinal: z.number().int().min(1).max(3),
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
  scenes: z.array(storySceneSchema).max(3),
}).strict();

export type DreamStory = z.infer<typeof dreamStorySchema>;
export type StoryScene = z.infer<typeof storySceneSchema>;
export type StoryVersion = z.infer<typeof storyVersionSchema>;
