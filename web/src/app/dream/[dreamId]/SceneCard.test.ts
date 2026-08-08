import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SceneCard } from "@/app/dream/[dreamId]/SceneCard";
import type { StoryScene } from "@/lib/domain/story";

describe("editorial story sequence", () => {
  it("renders every moment in a story of arbitrary length", () => {
    const moments = Array.from({ length: 8 }, (_, index) => createElement(SceneCard, {
      dreamId: "dream-id",
      key: index,
      onStoryChanged: vi.fn(),
      scene: scene(index + 1),
      totalMoments: 8,
    }));

    const html = renderToStaticMarkup(createElement("div", null, moments));
    expect(html.match(/class="story-moment"/g)).toHaveLength(8);
    expect(html).toContain("Moment 8");
    expect(html).toContain("of 8");
  });
});

function scene(ordinal: number): StoryScene {
  return {
    id: `scene-${ordinal}`,
    ordinal,
    caption: `Remembered moment ${ordinal}`,
    versionId: null,
    imageUrl: null,
    versions: [],
  };
}
