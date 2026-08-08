import { beforeEach, expect, it, vi } from "vitest";
import { GET } from "@/app/api/identity/route";

const mocks = vi.hoisted(() => ({
  createUrl: vi.fn(),
  getActive: vi.fn(),
  requireUserId: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/user", () => ({
  AuthenticationError: class AuthenticationError extends Error {},
  requireUserId: mocks.requireUserId,
}));
vi.mock("@/lib/database/identity", () => ({
  createIdentityImageUrl: mocks.createUrl,
  getActiveIdentityReference: mocks.getActive,
}));

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.requireUserId.mockResolvedValue("user-1");
});

it("returns a private signed preview for the active Dream Self", async () => {
  mocks.getActive.mockResolvedValue({
    id: "identity-1",
    storage_path: "user-1/identity/identity-1/reference.png",
    width: 1_024,
    height: 768,
    created_at: "2026-08-08T00:00:00+00:00",
  });
  mocks.createUrl.mockResolvedValue("https://storage.test/signed-preview");

  const response = await GET();

  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  await expect(response.json()).resolves.toEqual({ identity: {
    id: "identity-1",
    previewUrl: "https://storage.test/signed-preview",
    width: 1_024,
    height: 768,
    createdAt: "2026-08-08T00:00:00+00:00",
  } });
});

it("does not mint a URL when no Dream Self exists", async () => {
  mocks.getActive.mockResolvedValue(null);

  const response = await GET();

  await expect(response.json()).resolves.toEqual({ identity: null });
  expect(mocks.createUrl).not.toHaveBeenCalled();
});
