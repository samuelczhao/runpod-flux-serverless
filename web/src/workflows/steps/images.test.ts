import { beforeEach, expect, it, vi } from "vitest";
import { submitAnchorStep } from "@/workflows/steps/images";

const mocks = vi.hoisted(() => ({
  claim: vi.fn(),
  createIdentityUrl: vi.fn(),
  ensureVersion: vi.fn(),
  getDream: vi.fn(),
  getIdentity: vi.fn(),
  getScene: vi.fn(),
  record: vi.fn(),
  submit: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/config/env", () => ({
  getRunpodEnv: () => ({
    apiKey: "secret",
    fluxEndpointId: "flux-endpoint",
    kontextEndpointId: "kontext-endpoint",
  }),
}));
vi.mock("@/lib/database/dreams", () => ({ getProcessingDream: mocks.getDream }));
vi.mock("@/lib/database/identity", () => ({
  createIdentityProviderUrl: mocks.createIdentityUrl,
  getIdentityReference: mocks.getIdentity,
}));
vi.mock("@/lib/database/jobs", () => ({
  claimGenerationJob: mocks.claim,
  recordGenerationSubmission: mocks.record,
  transitionGenerationJob: vi.fn(),
}));
vi.mock("@/lib/database/scenes", () => ({
  ensureInitialVersion: mocks.ensureVersion,
  getScene: mocks.getScene,
  getSelectedVersion: vi.fn(),
}));
vi.mock("@/lib/database/storage", () => ({ createDreamImageUrl: vi.fn() }));
vi.mock("@/lib/runpod/queue", () => ({ submitQueueJob: mocks.submit }));
vi.mock("@/lib/runpod/submission", () => ({ recordSubmissionFailure: vi.fn() }));

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.getScene.mockResolvedValue({ id: "scene-1", dream_id: "dream-1", ordinal: 1,
    caption: "Crossing", prompt: "The dreamer crosses a moonlit bridge" });
  mocks.ensureVersion.mockResolvedValue({ id: "version-1", seed: 7 });
  mocks.claim.mockResolvedValue({ jobId: "job-1", status: "SUBMITTING", externalId: null, claimed: true });
  mocks.submit.mockResolvedValue("provider-1");
  mocks.record.mockResolvedValue(undefined);
});

it("uses the same private Dream Self for an identity-aware first scene", async () => {
  mocks.getDream.mockResolvedValue(dream("identity-1"));
  mocks.getIdentity.mockResolvedValue(identityReference());
  mocks.createIdentityUrl
    .mockResolvedValueOnce("https://storage.test/first-signature")
    .mockResolvedValueOnce("https://storage.test/second-signature");

  await submitAnchorStep("dream-1");
  const firstHash = mocks.claim.mock.calls[0][0].requestHash as string;
  await submitAnchorStep("dream-1");
  const secondHash = mocks.claim.mock.calls[1][0].requestHash as string;

  expect(mocks.claim.mock.calls[0][0]).toMatchObject({
    stage: "identity_scene",
    model: "black-forest-labs/FLUX.1-Kontext-dev",
    endpointId: "kontext-endpoint",
  });
  expect(firstHash).toBe(secondHash);
  expect(mocks.submit.mock.calls[0][1]).toMatchObject({
    image: "https://storage.test/first-signature",
    enable_safety_checker: true,
  });
});

it("preserves the required custom FLUX endpoint when no photo is attached", async () => {
  mocks.getDream.mockResolvedValue(dream(null));

  await submitAnchorStep("dream-1");

  expect(mocks.getIdentity).not.toHaveBeenCalled();
  expect(mocks.claim.mock.calls[0][0]).toMatchObject({
    stage: "anchor",
    model: "black-forest-labs/FLUX.1-dev",
    endpointId: "flux-endpoint",
  });
  expect(mocks.submit.mock.calls[0][1]).not.toHaveProperty("image");
});

it("does not claim paid work when the private reference cannot be signed", async () => {
  mocks.getDream.mockResolvedValue(dream("identity-1"));
  mocks.getIdentity.mockResolvedValue(identityReference());
  mocks.createIdentityUrl.mockRejectedValue(new Error("storage unavailable"));

  await expect(submitAnchorStep("dream-1")).rejects.toThrow("storage unavailable");

  expect(mocks.claim).not.toHaveBeenCalled();
  expect(mocks.submit).not.toHaveBeenCalled();
});

it("keeps identity, style, and visual continuity when a scene prompt is long", async () => {
  mocks.getDream.mockResolvedValue({
    ...dream("identity-1"),
    visual_bible: "The dreamer carries a scarlet compass in every scene",
  });
  mocks.getIdentity.mockResolvedValue(identityReference());
  mocks.getScene.mockResolvedValue({
    id: "scene-1", dream_id: "dream-1", ordinal: 1, caption: "Crossing",
    prompt: `The dreamer crosses a moonlit bridge ${"with drifting lanterns ".repeat(120)}`,
  });
  mocks.createIdentityUrl.mockResolvedValue("https://storage.test/signed-reference");

  await submitAnchorStep("dream-1");

  const prompt = String(mocks.submit.mock.calls[0][1].prompt);
  expect(prompt).toContain("only as the identity and appearance guide");
  expect(prompt).toContain("single continuous visual moment");
  expect(prompt).toContain("same single dreamer");
  expect(prompt).toContain("one body performs the described action");
  expect(prompt).toContain("dreamer appears exactly once");
  expect(prompt).toContain("full-body or three-quarter figure");
  expect(prompt).toContain("action and setting occupy most of the image");
  expect(prompt).toContain("face, skin, hair, body, clothing");
  expect(prompt).toContain("Luminous cinematic painted realism");
  expect(prompt).toContain("scarlet compass");
  expect(prompt).toContain("moonlit bridge");
  expect(prompt.length).toBeLessThanOrEqual(2_000);
});

function dream(identityReferenceId: string | null) {
  return {
    id: "dream-1",
    user_id: "user-1",
    status: "GENERATING_ANCHOR",
    identity_reference_id: identityReferenceId,
    visual_style: "dream-cinema",
    visual_bible: "A rust coat, amber moonlight",
  };
}

function identityReference() {
  return {
    id: "identity-1",
    status: "READY",
    storage_path: "user-1/identity/identity-1/reference.png",
    content_sha256: "a".repeat(64),
  };
}
