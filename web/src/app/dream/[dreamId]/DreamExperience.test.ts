import { describe, expect, it } from "vitest";
import { storyProgress } from "@/app/dream/[dreamId]/DreamExperience";
import type { DreamStory, StoryScene } from "@/lib/domain/story";

describe("dream story progress copy", () => {
  it("reports progress for a story with an arbitrary number of moments", () => {
    const scenes = Array.from({ length: 8 }, (_, index) => scene(index + 1, index < 2));
    const progress = storyProgress({ status: "GENERATING_SCENES", scenes });

    expect(progress.title).toBe("Creating moment 3 of 8");
    expect(progress.copy).toContain("leave this page");
  });

  it("uses plain language before the number of moments is known", () => {
    const progress = storyProgress({ status: "PLANNING", scenes: [] });

    expect(progress.title).toBe("Reading your dream");
    expect(`${progress.title} ${progress.copy}`).not.toMatch(/GPU|Runpod|worker|endpoint|provider/i);
  });

  it("describes audio preparation without naming the transcription provider", () => {
    const progress = storyProgress({ status: "TRANSCRIBING", scenes: [] });

    expect(progress.title).toBe("Listening to your recording");
  });
});

function scene(ordinal: number, completed: boolean): StoryScene {
  return {
    id: `scene-${ordinal}`,
    ordinal,
    caption: `Moment ${ordinal}`,
    versionId: null,
    imageUrl: completed ? `https://images.example/${ordinal}.png` : null,
    versions: [],
  } satisfies DreamStory["scenes"][number];
}
