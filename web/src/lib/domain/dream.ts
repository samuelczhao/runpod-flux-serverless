import { z } from "zod";

export const dreamStatusSchema = z.enum([
  "DRAFT",
  "UPLOADED",
  "TRANSCRIBING",
  "PLANNING",
  "GENERATING_ANCHOR",
  "GENERATING_SCENES",
  "READY",
  "FAILED",
  "DELETING",
]);

export const motifKindSchema = z.enum([
  "person",
  "place",
  "object",
  "emotion",
  "theme",
]);

export const motifSchema = z.object({
  label: z.string().trim().min(1).max(80),
  kind: motifKindSchema,
}).strict();

export const scenePlanSchema = z.object({
  caption: z.string().trim().min(1).max(240),
  prompt: z.string().trim().min(1).max(2_000),
}).strict();

export const MIN_STORY_SCENES = 1;
export const MAX_STORY_SCENES = 6;

export const MOOD_LABELS = [
  "awe", "calm", "confusion", "curiosity", "delight", "fear", "hope",
  "joy", "loneliness", "longing", "melancholy", "mystery", "nostalgia",
  "peace", "sadness", "serenity", "tension", "unease", "uncertainty",
  "urgency", "wonder",
] as const;

const moodSchema = z.array(z.enum(MOOD_LABELS)).min(1).max(3);

export const dreamPlanSchema = z.object({
  title: z.string().trim().min(1).max(120),
  summary: z.string().trim().min(1).max(600),
  mood: moodSchema,
  motifs: z.array(motifSchema).min(1).max(8),
  visual_bible: z.string().trim().min(1).max(1_200),
  scenes: z.array(scenePlanSchema).min(MIN_STORY_SCENES).max(MAX_STORY_SCENES),
}).strict();

export type DreamPlan = z.infer<typeof dreamPlanSchema>;
export type DreamStatus = z.infer<typeof dreamStatusSchema>;
export type Motif = z.infer<typeof motifSchema>;
