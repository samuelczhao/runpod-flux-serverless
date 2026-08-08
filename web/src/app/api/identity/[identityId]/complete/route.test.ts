import { beforeEach, expect, it, vi } from "vitest";
import { POST } from "@/app/api/identity/[identityId]/complete/route";

const mocks = vi.hoisted(() => ({
  complete: vi.fn(),
  createUrl: vi.fn(),
  deleteObjects: vi.fn(),
  download: vi.fn(),
  getReference: vi.fn(),
  markSourceDeleted: vi.fn(),
  normalize: vi.fn(),
  requireUserId: vi.fn(),
  store: vi.fn(),
}));
const IDENTITY_ID = "376e377c-0d3f-4411-a257-5db73ca23648";
const SOURCE_PATH = `user-1/identity/${IDENTITY_ID}/source.jpg`;
const REFERENCE_PATH = `user-1/identity/${IDENTITY_ID}/reference.png`;

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/user", () => ({
  AuthenticationError: class AuthenticationError extends Error {},
  requireUserId: mocks.requireUserId,
}));
vi.mock("@/lib/database/identity", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/database/identity")>(),
  completeIdentityReference: mocks.complete,
  createIdentityImageUrl: mocks.createUrl,
  deleteIdentityObjects: mocks.deleteObjects,
  downloadIdentitySource: mocks.download,
  getIdentityReference: mocks.getReference,
  markIdentitySourceDeleted: mocks.markSourceDeleted,
  storeNormalizedIdentity: mocks.store,
}));
vi.mock("@/lib/images/normalizeIdentity", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/images/normalizeIdentity")>(),
  normalizeIdentityImage: mocks.normalize,
}));

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.requireUserId.mockResolvedValue("user-1");
  mocks.getReference.mockResolvedValue(reference("PENDING", SOURCE_PATH));
  mocks.download.mockResolvedValue(Buffer.from("source"));
  mocks.normalize.mockResolvedValue({
    bytes: Buffer.from("normalized"), width: 1_024, height: 768, sha256: "a".repeat(64),
  });
  mocks.store.mockResolvedValue(REFERENCE_PATH);
  mocks.complete.mockResolvedValue(undefined);
  mocks.deleteObjects.mockResolvedValue(undefined);
  mocks.markSourceDeleted.mockResolvedValue(undefined);
  mocks.createUrl.mockResolvedValue("https://storage.test/signed-preview");
});

it("normalizes the upload, commits metadata, and removes the original", async () => {
  const response = await POST(new Request("https://dreamtrace.test"), context());

  expect(response.status).toBe(200);
  expect(mocks.complete).toHaveBeenCalledWith(
    "user-1", IDENTITY_ID, REFERENCE_PATH, expect.objectContaining({ width: 1_024, height: 768 }),
  );
  expect(mocks.deleteObjects).toHaveBeenCalledWith([SOURCE_PATH]);
  expect(mocks.markSourceDeleted).toHaveBeenCalledWith("user-1", IDENTITY_ID, SOURCE_PATH);
});

it("repairs source cleanup when completion is replayed", async () => {
  mocks.getReference.mockResolvedValue(reference("READY", SOURCE_PATH));

  const response = await POST(new Request("https://dreamtrace.test"), context());

  expect(response.status).toBe(200);
  expect(mocks.normalize).not.toHaveBeenCalled();
  expect(mocks.deleteObjects).toHaveBeenCalledWith([SOURCE_PATH]);
  expect(mocks.markSourceDeleted).toHaveBeenCalledWith("user-1", IDENTITY_ID, SOURCE_PATH);
});

it("removes the normalized object when the database commit fails", async () => {
  mocks.complete.mockRejectedValue(new Error("database unavailable"));
  vi.spyOn(console, "error").mockImplementation(() => undefined);

  const response = await POST(new Request("https://dreamtrace.test"), context());

  expect(response.status).toBe(503);
  expect(mocks.deleteObjects).toHaveBeenCalledWith([REFERENCE_PATH]);
});

it("preserves the normalized object while a lost completion remains unknown", async () => {
  mocks.getReference
    .mockResolvedValueOnce(reference("PENDING", SOURCE_PATH))
    .mockRejectedValueOnce(new Error("database unavailable"));
  mocks.complete.mockRejectedValue(new Error("response lost"));
  vi.spyOn(console, "error").mockImplementation(() => undefined);

  const response = await POST(new Request("https://dreamtrace.test"), context());

  expect(response.status).toBe(503);
  expect(mocks.deleteObjects).not.toHaveBeenCalledWith([REFERENCE_PATH]);
});

it("preserves a committed object when the completion response is lost", async () => {
  mocks.getReference
    .mockResolvedValueOnce(reference("PENDING", SOURCE_PATH))
    .mockResolvedValueOnce({
      ...reference("READY", SOURCE_PATH),
      size_bytes: Buffer.from("normalized").length,
      width: 1_024,
      height: 768,
      content_sha256: "a".repeat(64),
    });
  mocks.complete.mockRejectedValue(new Error("response lost"));

  const response = await POST(new Request("https://dreamtrace.test"), context());

  expect(response.status).toBe(200);
  expect(mocks.deleteObjects).not.toHaveBeenCalledWith([REFERENCE_PATH]);
  expect(mocks.deleteObjects).toHaveBeenCalledWith([SOURCE_PATH]);
});

function context() {
  return { params: Promise.resolve({ identityId: IDENTITY_ID }) };
}

function reference(status: "PENDING" | "READY", uploadPath: string | null) {
  return {
    id: IDENTITY_ID,
    user_id: "user-1",
    status,
    upload_path: uploadPath,
    storage_path: status === "READY" ? REFERENCE_PATH : null,
  };
}
