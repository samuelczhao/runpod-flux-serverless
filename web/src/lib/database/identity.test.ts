import { beforeEach, expect, it, vi } from "vitest";
import { StorageApiError } from "@supabase/supabase-js";
import {
  cleanupIdentityCandidates,
  prepareIdentityUpload,
  storeNormalizedIdentity,
} from "@/lib/database/identity";

const mocks = vi.hoisted(() => ({
  createSignedUploadUrl: vi.fn(),
  download: vi.fn(),
  exists: vi.fn(),
  remove: vi.fn(),
  rpc: vi.fn(),
  upload: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    rpc: mocks.rpc,
    storage: { from: () => ({
      createSignedUploadUrl: mocks.createSignedUploadUrl,
      download: mocks.download,
      exists: mocks.exists,
      remove: mocks.remove,
      upload: mocks.upload,
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

it("reuses an identical normalized object without overwriting it", async () => {
  const bytes = Buffer.from("normalized");
  mocks.upload.mockResolvedValue({ data: null, error: { message: "already exists" } });
  mocks.download.mockResolvedValue({ data: new Blob([bytes]), error: null });

  await expect(storeNormalizedIdentity(USER_ID, IDENTITY_ID, {
    bytes, width: 1_024, height: 768, sha256: "a".repeat(64),
  })).resolves.toBe(`${USER_ID}/identity/${IDENTITY_ID}/reference.png`);

  expect(mocks.upload).toHaveBeenCalledWith(
    `${USER_ID}/identity/${IDENTITY_ID}/reference.png`,
    bytes,
    { contentType: "image/png", upsert: false },
  );
});

it("rejects a conflicting normalized object instead of overwriting it", async () => {
  mocks.upload.mockResolvedValue({ data: null, error: { message: "already exists" } });
  mocks.download.mockResolvedValue({ data: new Blob([Buffer.from("other")]), error: null });

  await expect(storeNormalizedIdentity(USER_ID, IDENTITY_ID, {
    bytes: Buffer.from("normalized"), width: 1_024, height: 768, sha256: "a".repeat(64),
  })).rejects.toThrow("already exists");
});

it("claims a due tombstone before deleting its deterministic path", async () => {
  mocks.rpc
    .mockResolvedValueOnce({ data: [{
      reference_id: IDENTITY_ID,
      user_id: USER_ID,
      cleanup_kind: "tombstone",
    }], error: null })
    .mockResolvedValueOnce({ data: [{
      source_path: null,
      reference_path: `${USER_ID}/identity/${IDENTITY_ID}/reference.png`,
    }], error: null })
    .mockResolvedValueOnce({ data: null, error: null })
    .mockResolvedValueOnce({
      data: [{ due_count: 0, oldest_due_at: null }], error: null,
    });
  mocks.remove.mockResolvedValue({ data: [], error: null });

  await expect(cleanupIdentityCandidates(50)).resolves.toEqual({
    inspected: 1, failed: 0, remaining: 0, oldestDueAt: null,
  });
  expect(mocks.remove).toHaveBeenCalledWith([
    `${USER_ID}/identity/${IDENTITY_ID}/reference.png`,
  ]);
  expect(mocks.rpc).toHaveBeenNthCalledWith(2, "begin_identity_cleanup", {
    p_reference_id: IDENTITY_ID,
    p_user_id: USER_ID,
    p_cleanup_kind: "tombstone",
  });
  expect(mocks.rpc).toHaveBeenNthCalledWith(3, "complete_identity_tombstone_cleanup", {
    p_reference_id: IDENTITY_ID,
    p_user_id: USER_ID,
  });
});

it("skips a stale cleanup candidate when its atomic claim is rejected", async () => {
  mocks.rpc
    .mockResolvedValueOnce({ data: [{
      reference_id: IDENTITY_ID,
      user_id: USER_ID,
      cleanup_kind: "reference",
    }], error: null })
    .mockResolvedValueOnce({ data: [], error: null })
    .mockResolvedValueOnce({
      data: [{ due_count: 0, oldest_due_at: null }], error: null,
    });

  await expect(cleanupIdentityCandidates(50)).resolves.toEqual({
    inspected: 1, failed: 0, remaining: 0, oldestDueAt: null,
  });
  expect(mocks.remove).not.toHaveBeenCalled();
  expect(mocks.rpc).not.toHaveBeenCalledWith("complete_identity_deletion", expect.anything());
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
