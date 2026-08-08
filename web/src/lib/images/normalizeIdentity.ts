import "server-only";
import { createHash } from "node:crypto";
import sharp from "sharp";
import {
  MAX_IDENTITY_IMAGE_BYTES,
  MAX_IDENTITY_IMAGE_DIMENSION,
  MAX_IDENTITY_INPUT_PIXELS,
  MIN_IDENTITY_IMAGE_DIMENSION,
} from "@/lib/domain/identity";

export interface NormalizedIdentityImage {
  readonly bytes: Buffer;
  readonly width: number;
  readonly height: number;
  readonly sha256: string;
}

export class IdentityImageError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "IdentityImageError";
  }
}

export async function normalizeIdentityImage(source: Buffer): Promise<NormalizedIdentityImage> {
  if (source.length === 0 || source.length > MAX_IDENTITY_IMAGE_BYTES) {
    throw new IdentityImageError("Photo must be between 1 byte and 8 MB");
  }
  try {
    const result = await sharp(source, {
      failOn: "warning",
      limitInputPixels: MAX_IDENTITY_INPUT_PIXELS,
    })
      .rotate()
      .resize({
        width: MAX_IDENTITY_IMAGE_DIMENSION,
        height: MAX_IDENTITY_IMAGE_DIMENSION,
        fit: "inside",
        withoutEnlargement: true,
      })
      .flatten({ background: "#f4ecdf" })
      .toColourspace("srgb")
      .png({ adaptiveFiltering: true, compressionLevel: 9 })
      .toBuffer({ resolveWithObject: true });
    return normalizedResult(result.data, result.info.width, result.info.height);
  } catch (error: unknown) {
    if (error instanceof IdentityImageError) throw error;
    throw new IdentityImageError("Photo could not be decoded safely");
  }
}

function normalizedResult(bytes: Buffer, width: number, height: number): NormalizedIdentityImage {
  if (Math.min(width, height) < MIN_IDENTITY_IMAGE_DIMENSION) {
    throw new IdentityImageError("Photo is too small; use at least 256 pixels on each side");
  }
  if (bytes.length > MAX_IDENTITY_IMAGE_BYTES) {
    throw new IdentityImageError("Normalized photo exceeds 8 MB");
  }
  return {
    bytes,
    width,
    height,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}
