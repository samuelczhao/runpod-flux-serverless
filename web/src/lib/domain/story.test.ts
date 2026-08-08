import { describe, expect, it } from "vitest";
import {
  dreamStorySchema,
  preserveStoryImageUrls,
  shouldPollDream,
  type DreamStory,
  type StoryVersion,
} from "@/lib/domain/story";

const ID = "5deefbe0-2003-4af4-b75e-0bd9c22bed60";

function story(status: DreamStory["status"], versions: StoryVersion[] = []): DreamStory {
  return {
    id: ID, status, inputMode: "text", transcript: "A dream", awaitingTranscriptReview: false,
    title: null, summary: null, mood: [], failedStage: null, errorCode: null,
    scenes: versions.length ? [{ id: ID, ordinal: 1, caption: "Moon", versionId: ID,
      imageUrl: null, versions }] : [],
  };
}

function version(status: StoryVersion["status"]): StoryVersion {
  return { id: ID, parentVersionId: ID, editInstruction: "More moonlight", status,
    isSelected: false, imageUrl: null };
}

describe("dream story polling", () => {
  it.each([1, 6])("accepts a story with %i scenes", (sceneCount) => {
    const scene = story("READY", [version("COMPLETED")]).scenes[0];
    expect(dreamStorySchema.safeParse({
      ...story("READY"), scenes: Array.from({ length: sceneCount }, () => scene),
    }).success).toBe(true);
  });

  it("rejects a story with more than six scenes", () => {
    const scene = story("READY", [version("COMPLETED")]).scenes[0];
    expect(dreamStorySchema.safeParse({
      ...story("READY"), scenes: Array.from({ length: 7 }, () => scene),
    }).success).toBe(false);
  });

  it.each(["DRAFT", "PLANNING", "GENERATING_ANCHOR", "GENERATING_SCENES"] as const)(
    "continues while %s can still advance",
    (status) => expect(shouldPollDream(story(status))).toBe(true),
  );

  it("stops after a failed dream", () => {
    expect(shouldPollDream(story("FAILED"))).toBe(false);
  });

  it.each(["PENDING", "SUBMITTING", "QUEUED", "RUNNING"] as const)(
    "keeps a READY dream fresh while a branch is %s",
    (status) => expect(shouldPollDream(story("READY", [version(status)]))).toBe(true),
  );

  it.each(["COMPLETED", "FAILED", "CANCELLED", "SUBMIT_UNKNOWN"] as const)(
    "stops a READY dream after its branch is %s",
    (status) => expect(shouldPollDream(story("READY", [version(status)]))).toBe(false),
  );

  it("stops a READY dream without a branch", () => {
    expect(shouldPollDream(story("READY"))).toBe(false);
  });

  it("preserves a signed URL while a version identity is unchanged", () => {
    const current = story("READY", [{ ...version("COMPLETED"), imageUrl: "https://old.example/a.png" }]);
    const next = story("READY", [{ ...version("COMPLETED"), imageUrl: "https://new.example/a.png" }]);
    expect(preserveStoryImageUrls(current, next).scenes[0]?.versions[0]?.imageUrl)
      .toBe("https://old.example/a.png");
  });
});
