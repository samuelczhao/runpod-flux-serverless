import { beforeEach, expect, it, vi } from "vitest";
import { createDreamAudioUpload } from "@/lib/database/storage";

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
