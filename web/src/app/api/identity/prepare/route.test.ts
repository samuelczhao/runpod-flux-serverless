import { beforeEach, expect, it, vi } from "vitest";
import { POST } from "@/app/api/identity/prepare/route";
import { DatabaseOperationError } from "@/lib/database/errors";

const mocks = vi.hoisted(() => ({ prepare: vi.fn(), requireUserId: vi.fn() }));
const OPERATION_ID = "ff5f82ba-3c73-4b3d-bd85-39004f7a645f";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/user", () => ({
  AuthenticationError: class AuthenticationError extends Error {},
  requireUserId: mocks.requireUserId,
}));
vi.mock("@/lib/database/identity", () => ({
  IdentityPreparationError: class IdentityPreparationError extends Error {},
  prepareIdentityUpload: mocks.prepare,
}));

beforeEach(() => {
  mocks.prepare.mockReset();
  mocks.requireUserId.mockReset();
  mocks.requireUserId.mockResolvedValue("user-1");
  mocks.prepare.mockResolvedValue({
    status: "upload",
    identityId: "376e377c-0d3f-4411-a257-5db73ca23648",
    path: "user-1/identity/reference/source.jpg",
    token: "signed-upload-token",
  });
});

it("requires versioned consent before preparing private storage", async () => {
  const response = await POST(request({ consentConfirmed: true }));

  expect(response.status).toBe(201);
  expect(mocks.prepare).toHaveBeenCalledWith(
    "user-1", OPERATION_ID, "image/jpeg", true,
  );
});

it("rejects missing consent without allocating storage", async () => {
  const response = await POST(request({ consentConfirmed: false }));

  expect(response.status).toBe(400);
  expect(mocks.prepare).not.toHaveBeenCalled();
});

it.each([
  ["P4295", "hourly photo limit"],
  ["P4296", "today’s photo limit"],
  ["P4297", "Two photos are already being prepared"],
])("returns a useful response for photo quota %s", async (code, message) => {
  mocks.prepare.mockRejectedValue(new DatabaseOperationError({ code, message: "quota" }));

  const response = await POST(request({}));

  expect(response.status).toBe(429);
  expect((await response.json()).error).toContain(message);
});

function request(overrides: Readonly<Record<string, unknown>>): Request {
  return new Request("https://dreamtrace.test/api/identity/prepare", {
    method: "POST",
    body: JSON.stringify({
      operationId: OPERATION_ID,
      mimeType: "image/jpeg",
      sizeBytes: 1_024,
      consentConfirmed: true,
      consentVersion: "dream-self-v1",
      ...overrides,
    }),
  });
}
