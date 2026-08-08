import { beforeAll, expect, it, vi } from "vitest";
import sharp from "sharp";
import {
  IdentityImageError,
  normalizeIdentityImage,
} from "@/lib/images/normalizeIdentity";

vi.mock("server-only", () => ({}));

let jpeg: Buffer;

beforeAll(async () => {
  jpeg = await sharp({
    create: {
      width: 3_000,
      height: 1_500,
      channels: 3,
      background: "#84685b",
    },
  }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
});

it("normalizes, bounds, and hashes an uploaded photo", async () => {
  const result = await normalizeIdentityImage(jpeg);
  const metadata = await sharp(result.bytes).metadata();
  expect(metadata.format).toBe("png");
  expect(Math.max(result.width, result.height)).toBe(2_048);
  expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
  expect(metadata.exif).toBeUndefined();
  expect(metadata.orientation).toBeUndefined();
});

it("rejects undecodable and oversized uploads", async () => {
  await expect(normalizeIdentityImage(Buffer.from("not an image")))
    .rejects.toBeInstanceOf(IdentityImageError);
  await expect(normalizeIdentityImage(Buffer.alloc(8_388_609)))
    .rejects.toBeInstanceOf(IdentityImageError);
});

it("rejects images too small to serve as a useful identity reference", async () => {
  const tiny = await sharp({
    create: { width: 64, height: 64, channels: 3, background: "#84685b" },
  }).png().toBuffer();
  await expect(normalizeIdentityImage(tiny)).rejects.toThrow("too small");
});
