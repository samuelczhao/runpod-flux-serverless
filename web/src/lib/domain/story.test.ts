import { describe, expect, it } from "vitest";
import {
  dreamStorySchema,
  mergeStoryPollResult,
  planDreamPoll,
  preserveStoryImageUrls,
  type DreamStory,
  type StoryVersion,
} from "@/lib/domain/story";

const ID = "5deefbe0-2003-4af4-b75e-0bd9c22bed60";
const NOW = Date.parse("2026-08-09T00:00:00.000Z");
const ISSUED_AT = new Date(NOW).toISOString();

function story(status: DreamStory["status"], versions: StoryVersion[] = []): DreamStory {
  return {
    id: ID, status, inputMode: "text", transcript: "A dream", awaitingTranscriptReview: false,
    title: null, summary: null, mood: [], failedStage: null, errorCode: null,
    imageUrlsIssuedAt: ISSUED_AT,
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
    (status) => expect(planDreamPoll(story(status))).toEqual({
      delayMs: 3_000, preserveImageUrls: true,
    }),
  );

  it("stops after a failed dream", () => {
    expect(planDreamPoll(story("FAILED"))).toBeNull();
  });

  it.each(["PENDING", "SUBMITTING", "QUEUED", "RUNNING"] as const)(
    "keeps a READY dream fresh while a branch is %s",
    (status) => expect(planDreamPoll(story("READY", [version(status)])))
      .toEqual({ delayMs: 3_000, preserveImageUrls: true }),
  );

  it.each(["COMPLETED", "FAILED", "CANCELLED", "SUBMIT_UNKNOWN"] as const)(
    "stops a READY dream after its branch is %s",
    (status) => expect(planDreamPoll(story("READY", [version(status)]))).toBeNull(),
  );

  it("stops a READY dream without a branch", () => {
    expect(planDreamPoll(story("READY"))).toBeNull();
  });

  it("renews READY image URLs ten minutes before expiration", () => {
    const ready = story("READY", [{ ...version("COMPLETED"),
      isSelected: true, imageUrl: "https://old.example/a.png" }]);
    ready.scenes[0]!.imageUrl = "https://old.example/a.png";
    expect(planDreamPoll(ready, NOW)).toEqual({ delayMs: 3_000_000, preserveImageUrls: false });
  });

  it("preserves a signed URL while a version identity is unchanged", () => {
    const current = story("READY", [{ ...version("COMPLETED"), imageUrl: "https://old.example/a.png" }]);
    const next = story("READY", [{ ...version("COMPLETED"), imageUrl: "https://new.example/a.png" }]);
    const merged = preserveStoryImageUrls(current, next);
    expect(merged.scenes[0]?.versions[0]?.imageUrl).toBe("https://old.example/a.png");
    expect(merged.imageUrlsIssuedAt).toBe(current.imageUrlsIssuedAt);
  });

  it("replaces a signed URL during a renewal poll", () => {
    const current = story("READY", [{ ...version("COMPLETED"), imageUrl: "https://old.example/a.png" }]);
    const next = story("READY", [{ ...version("COMPLETED"), imageUrl: "https://new.example/a.png" }]);
    expect(mergeStoryPollResult(current, next, false).scenes[0]?.versions[0]?.imageUrl)
      .toBe("https://new.example/a.png");
  });

  it("replaces aged URLs when an active story becomes READY", () => {
    const current = story("GENERATING_SCENES", [{
      ...version("COMPLETED"), imageUrl: "https://old.example/a.png",
    }]);
    const next = story("READY", [{ ...version("COMPLETED"), imageUrl: "https://new.example/a.png" }]);
    expect(mergeStoryPollResult(current, next, true).scenes[0]?.versions[0]?.imageUrl)
      .toBe("https://new.example/a.png");
  });

  it("replaces aged URLs when an active branch becomes terminal", () => {
    const current = story("READY", [{ ...version("RUNNING"), imageUrl: "https://old.example/a.png" }]);
    const next = story("READY", [{ ...version("COMPLETED"), imageUrl: "https://new.example/a.png" }]);
    expect(mergeStoryPollResult(current, next, true).scenes[0]?.versions[0]?.imageUrl)
      .toBe("https://new.example/a.png");
  });

  it("renews aged URLs while a branch remains active", () => {
    const current = story("READY", [{
      ...version("RUNNING"), isSelected: true, imageUrl: "https://old.example/a.png",
    }]);
    current.scenes[0]!.imageUrl = "https://old.example/a.png";
    current.imageUrlsIssuedAt = new Date(NOW - 3_000_000).toISOString();
    const next = story("READY", [{
      ...version("RUNNING"), isSelected: true, imageUrl: "https://new.example/a.png",
    }]);
    next.scenes[0]!.imageUrl = "https://new.example/a.png";

    const merged = mergeStoryPollResult(current, next, true, NOW);
    expect(merged.scenes[0]?.versions[0]?.imageUrl).toBe("https://new.example/a.png");
    expect(merged.imageUrlsIssuedAt).toBe(next.imageUrlsIssuedAt);
  });

  it("schedules terminal renewal from the actual signing time", () => {
    const ready = story("READY", [{
      ...version("COMPLETED"), isSelected: true, imageUrl: "https://old.example/a.png",
    }]);
    ready.scenes[0]!.imageUrl = "https://old.example/a.png";
    ready.imageUrlsIssuedAt = new Date(NOW - 2_940_000).toISOString();

    expect(planDreamPoll(ready, NOW)).toEqual({ delayMs: 60_000, preserveImageUrls: false });
  });
});
