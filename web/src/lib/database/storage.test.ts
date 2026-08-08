import { beforeEach, expect, it, vi } from "vitest";
import {
  createDreamAudioUpload,
  downloadProviderPng,
  ProviderArtifactError,
} from "@/lib/database/storage";

const mocks = vi.hoisted(() => ({ createSignedUploadUrl: vi.fn() }));
const USER_ID = "40911ce1-a4a6-47c4-8409-b782e80a32c4";
const DREAM_ID = "376e377c-0d3f-4411-a257-5db73ca23648";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    storage: { from: () => ({ createSignedUploadUrl: mocks.createSignedUploadUrl }) },
  }),
}));

beforeEach(() => mocks.createSignedUploadUrl.mockReset());

it("returns only the public signed-upload contract", async () => {
  const path = `${USER_ID}/${DREAM_ID}/source.ogg`;
  mocks.createSignedUploadUrl.mockResolvedValue({
    data: { path, token: "upload-token", signedUrl: "https://storage.example/upload" },
    error: null,
  });

  await expect(createDreamAudioUpload(USER_ID, DREAM_ID, "audio/ogg")).resolves.toEqual({
    path,
    token: "upload-token",
  });
});

it("downloads a valid streamed PNG", async () => {
  const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]);
  const fetcher = vi.fn().mockResolvedValue(new Response(bytes));
  await expect(downloadProviderPng("https://images.example/dream.png", fetcher)).resolves.toEqual(bytes);
});

it("bounds a chunked image response without Content-Length", async () => {
  const oversized = new Uint8Array(10_000_001);
  const fetcher = vi.fn().mockResolvedValue(new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(oversized);
      controller.close();
    },
  })));
  await expect(downloadProviderPng("https://images.example/large.png", fetcher))
    .rejects.toBeInstanceOf(ProviderArtifactError);
});

it("separates permanent artifacts from transient provider failures", async () => {
  const invalid = vi.fn().mockResolvedValue(new Response("not png"));
  await expect(downloadProviderPng("https://images.example/text", invalid))
    .rejects.toBeInstanceOf(ProviderArtifactError);
  const unavailable = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));
  await expect(downloadProviderPng("https://images.example/down", unavailable))
    .rejects.not.toBeInstanceOf(ProviderArtifactError);
  for (const status of [408, 429]) {
    const retryable = vi.fn().mockResolvedValue(new Response(null, { status }));
    await expect(downloadProviderPng("https://images.example/retry", retryable))
      .rejects.not.toBeInstanceOf(ProviderArtifactError);
  }
});
