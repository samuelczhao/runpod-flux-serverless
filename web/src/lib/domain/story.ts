import { z } from "zod";
import { dreamStatusSchema } from "@/lib/domain/dream";

export const storySceneSchema = z.object({
  id: z.uuid(),
  ordinal: z.number().int().min(1).max(3),
  caption: z.string(),
  versionId: z.uuid().nullable(),
  imageUrl: z.url().nullable(),
}).strict();

export const dreamStorySchema = z.object({
  id: z.uuid(),
  status: dreamStatusSchema,
  title: z.string().nullable(),
  summary: z.string().nullable(),
  mood: z.array(z.string()),
  failedStage: z.string().nullable(),
  errorCode: z.string().nullable(),
  scenes: z.array(storySceneSchema).max(3),
}).strict();

export type DreamStory = z.infer<typeof dreamStorySchema>;
export type StoryScene = z.infer<typeof storySceneSchema>;
