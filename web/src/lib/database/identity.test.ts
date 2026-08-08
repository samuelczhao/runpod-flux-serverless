import { beforeEach, expect, it, vi } from "vitest";
import { StorageApiError } from "@supabase/supabase-js";
import { cleanupIdentityCandidates, prepareIdentityUpload } from "@/lib/database/identity";

const mocks = vi.hoisted(() => ({
  createSignedUploadUrl: vi.fn(),
  exists: vi.fn(),
  remove: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    rpc: mocks.rpc,
    storage: { from: () => ({
      createSignedUploadUrl: mocks.createSignedUploadUrl,
      exists: mocks.exists,
      remove: mocks.remove,
    }) },
  }),
}));

const USER_ID = "40911ce1-a4a6-47c4-8409-b782e80a32c4";
const IDENTITY_ID = "376e377c-0d3f-4411-a257-5db73ca23648";
const OPERATION_ID = "ff5f82ba-3c73-4b3d-bd85-39004f7a645f";
const SOURCE_PATH = `${USER_ID}/identity/${IDENTITY_ID}/source.jpg`;

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
});

it("returns only the public signed upload contract for a new photo", async () => {
  mocks.rpc.mockResolvedValue(prepared("PENDING"));
  mocks.exists.mockResolvedValue({
    data: false,
    error: new StorageApiError("HTTP 400 error", 400, "400"),
  });
  mocks.createSignedUploadUrl.mockResolvedValue({
    data: {
      path: SOURCE_PATH,
      token: "upload-token",
      signedUrl: "https://storage.test/private-provider-field",
    },
    error: null,
  });

  await expect(prepareIdentityUpload(USER_ID, OPERATION_ID, "image/jpeg", true)).resolves.toEqual({
    status: "upload",
    identityId: IDENTITY_ID,
    path: SOURCE_PATH,
    token: "upload-token",
  });
});

it("does not hide a real storage failure while checking for a replay", async () => {
  mocks.rpc.mockResolvedValue(prepared("PENDING"));
  mocks.exists.mockResolvedValue({
    data: false,
    error: new StorageApiError("Service unavailable", 503, "503"),
  });

  await expect(prepareIdentityUpload(USER_ID, OPERATION_ID, "image/jpeg", true))
    .rejects.toThrow("Service unavailable");
  expect(mocks.createSignedUploadUrl).not.toHaveBeenCalled();
});

it("resumes from an already stored or completed photo without overwriting", async () => {
  mocks.rpc.mockResolvedValue(prepared("PENDING"));
  mocks.exists.mockResolvedValue({ data: true, error: null });
  await expect(prepareIdentityUpload(USER_ID, OPERATION_ID, "image/jpeg", true)).resolves.toEqual({
    status: "stored",
    identityId: IDENTITY_ID,
  });
  expect(mocks.createSignedUploadUrl).not.toHaveBeenCalled();

  mocks.rpc.mockResolvedValue(prepared("READY"));
  await expect(prepareIdentityUpload(USER_ID, OPERATION_ID, "image/jpeg", true)).resolves.toEqual({
    status: "ready",
    identityId: IDENTITY_ID,
  });
});

it("rechecks the deterministic path after a deleted-reference race", async () => {
  mocks.rpc
    .mockResolvedValueOnce({ data: [{
      reference_id: IDENTITY_ID,
      user_id: USER_ID,
      cleanup_kind: "tombstone",
    }], error: null })
    .mockResolvedValueOnce({ data: null, error: null });
  mocks.remove.mockResolvedValue({ data: [], error: null });

  await expect(cleanupIdentityCandidates(50)).resolves.toEqual({ inspected: 1, failed: 0 });
  expect(mocks.remove).toHaveBeenCalledWith([
    `${USER_ID}/identity/${IDENTITY_ID}/reference.png`,
  ]);
  expect(mocks.rpc).toHaveBeenLastCalledWith("complete_identity_tombstone_cleanup", {
    p_reference_id: IDENTITY_ID,
    p_user_id: USER_ID,
  });
});

function prepared(status: "PENDING" | "READY") {
  return {
    data: [{
      reference_id: IDENTITY_ID,
      reference_status: status,
      source_path: SOURCE_PATH,
    }],
    error: null,
  };
}
