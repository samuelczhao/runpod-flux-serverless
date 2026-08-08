import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SceneCard } from "@/app/dream/[dreamId]/SceneCard";
import type { StoryScene } from "@/lib/domain/story";

describe("editorial story sequence", () => {
  it("renders every moment in a six-scene story", () => {
    const moments = Array.from({ length: 6 }, (_, index) => createElement(SceneCard, {
      dreamId: "dream-id",
      key: index,
      onStoryChanged: vi.fn(),
      scene: scene(index + 1),
      totalMoments: 6,
    }));

    const html = renderToStaticMarkup(createElement("div", null, moments));
    expect(html.match(/class="story-moment"/g)).toHaveLength(6);
    expect(html).toContain("Moment 6");
    expect(html).toContain("of 6");
  });

  it("offers a fresh edit after a terminal branch failure", () => {
    const html = renderToStaticMarkup(createElement(SceneCard, {
      dreamId: "dream-id", onStoryChanged: vi.fn(), scene: sceneWithBranch("FAILED"), totalMoments: 1,
    }));
    expect(html).toContain("We couldn’t make the new version");
    expect(html).toContain("Try another edit");
  });

  it("stops promising progress after an ambiguous submission", () => {
    const html = renderToStaticMarkup(createElement(SceneCard, {
      dreamId: "dream-id", onStoryChanged: vi.fn(),
      scene: sceneWithBranch("SUBMIT_UNKNOWN"), totalMoments: 1,
    }));
    expect(html).toContain("couldn’t confirm that the new version started");
    expect(html).not.toContain("Still working");
  });

  it("labels an unselected generated branch as the new version", () => {
    const html = renderToStaticMarkup(createElement(SceneCard, {
      dreamId: "dream-id", onStoryChanged: vi.fn(),
      scene: selectableScene(false), totalMoments: 1,
    }));
    expect(html).toContain("New version:");
    expect(html).toContain("Use new version");
  });

  it("labels an unselected root image as the original version", () => {
    const html = renderToStaticMarkup(createElement(SceneCard, {
      dreamId: "dream-id", onStoryChanged: vi.fn(),
      scene: selectableScene(true), totalMoments: 1,
    }));
    expect(html).toContain("Original version:");
    expect(html).toContain("Use original version");
    expect(html).not.toContain("New version:");
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

function sceneWithBranch(status: StoryScene["versions"][number]["status"]): StoryScene {
  return { ...scene(1), versions: [{
    id: "branch-1", parentVersionId: "version-1", editInstruction: "More moonlight",
    status, isSelected: false, imageUrl: null,
  }] };
}

function selectableScene(branchSelected: boolean): StoryScene {
  const original = {
    id: "version-1", parentVersionId: null, editInstruction: null,
    status: "COMPLETED" as const, isSelected: !branchSelected, imageUrl: "https://example.com/original.png",
  };
  const branch = {
    id: "branch-1", parentVersionId: "version-1", editInstruction: "More moonlight",
    status: "COMPLETED" as const, isSelected: branchSelected, imageUrl: "https://example.com/branch.png",
  };
  const selected = branchSelected ? branch : original;
  return { ...scene(1), versionId: selected.id, imageUrl: selected.imageUrl, versions: [original, branch] };
}
