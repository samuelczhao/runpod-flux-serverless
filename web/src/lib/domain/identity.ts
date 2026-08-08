import { z } from "zod";

export const MAX_IDENTITY_IMAGE_BYTES = 8_388_608;
export const MAX_IDENTITY_IMAGE_DIMENSION = 2_048;
export const MAX_IDENTITY_INPUT_PIXELS = 25_000_000;
export const MIN_IDENTITY_IMAGE_DIMENSION = 256;
export const IDENTITY_CONSENT_VERSION = "dream-self-v1" as const;

export const identityMimeTypeSchema = z.enum([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export const identityStatusSchema = z.enum([
  "PENDING",
  "READY",
  "DELETING",
  "DELETED",
  "FAILED",
]);

export const visualStyleSchema = z.enum([
  "dream-cinema",
  "watercolor-memory",
  "graphic-surreal",
]);

export type IdentityMimeType = z.infer<typeof identityMimeTypeSchema>;
export type IdentityStatus = z.infer<typeof identityStatusSchema>;
export type VisualStyle = z.infer<typeof visualStyleSchema>;

export interface DreamCaptureOptions {
  readonly identityReferenceId: string | null;
  readonly visualStyle: VisualStyle;
}

export const DEFAULT_VISUAL_STYLE: VisualStyle = "watercolor-memory";

export const VISUAL_STYLE_PROMPTS: Readonly<Record<VisualStyle, string>> = {
  "dream-cinema": "Luminous cinematic painted realism, polished storybook illustration, natural facial proportions, soft brush texture, atmospheric depth, restrained dreamlike colors, subtle paper grain",
  "watercolor-memory": "Hand-painted watercolor storybook illustration, simplified yet recognizable facial likeness, translucent pigment blooms, dry-brush edges, colored-pencil contours, visible cotton-paper texture, gentle natural light, soft handmade imperfections",
  "graphic-surreal": "Editorial surrealist illustration, bold symbolic shapes, crisp recognizable facial landmarks, jewel-toned palette, elegant negative space, tactile print texture",
};
