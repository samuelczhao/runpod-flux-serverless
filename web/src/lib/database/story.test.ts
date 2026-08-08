import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database/types";
import { readDreamStory } from "@/lib/database/story";

vi.mock("server-only", () => ({}));

const DREAM_ID = "00000000-0000-4000-8000-000000000001";
const SCENE_ONE_ID = "00000000-0000-4000-8000-000000000002";
const SCENE_TWO_ID = "00000000-0000-4000-8000-000000000003";
const VERSION_ONE_ID = "00000000-0000-4000-8000-000000000004";
const VERSION_TWO_ID = "00000000-0000-4000-8000-000000000005";

describe("readDreamStory", () => {
  it("signs all completed scene images in one storage request", async () => {
    const createSignedUrls = vi.fn().mockResolvedValue({
      data: [
        signedImage("first.png", "https://images.example/first.png"),
        signedImage("second.png", "https://images.example/second.png"),
      ],
      error: null,
    });
    const client = createClient(createSignedUrls);

    const story = await readDreamStory(client, DREAM_ID);

    expect(createSignedUrls).toHaveBeenCalledOnce();
    expect(createSignedUrls).toHaveBeenCalledWith(["first.png", "second.png"], 3_600);
    expect(story?.scenes.map((scene) => scene.imageUrl)).toEqual([
      "https://images.example/first.png",
      "https://images.example/second.png",
    ]);
  });
});

function createClient(createSignedUrls: ReturnType<typeof vi.fn>): SupabaseClient<Database> {
  const from = vi.fn((table: string) => {
    if (table === "dreams") return dreamQuery();
    if (table === "scenes") return scenesQuery();
    if (table === "scene_versions") return versionsQuery();
    throw new Error(`Unexpected table ${table}`);
  });
  return {
    from,
    storage: { from: vi.fn(() => ({ createSignedUrls })) },
  } as unknown as SupabaseClient<Database>;
}

function dreamQuery() {
  const data = {
    id: DREAM_ID, status: "READY", input_mode: "text", transcript: "A short dream.",
    workflow_run_id: "run-1", title: "Dream", summary: "Summary", mood: ["wonder"],
    failed_stage: null, error_code: null,
  };
  return { select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data, error: null })) })) })) };
}

function scenesQuery() {
  const data = [
    { id: SCENE_ONE_ID, ordinal: 1, caption: "First" },
    { id: SCENE_TWO_ID, ordinal: 2, caption: "Second" },
  ];
  return { select: vi.fn(() => ({
    eq: vi.fn(() => ({ order: vi.fn(async () => ({ data, error: null })) })),
  })) };
}

function versionsQuery() {
  const data = [
    version(VERSION_ONE_ID, SCENE_ONE_ID, "first.png"),
    version(VERSION_TWO_ID, SCENE_TWO_ID, "second.png"),
  ];
  return { select: vi.fn(() => ({
    in: vi.fn(() => ({ order: vi.fn(async () => ({ data, error: null })) })),
  })) };
}

function version(id: string, sceneId: string, storagePath: string) {
  return {
    id, scene_id: sceneId, parent_version_id: null, storage_path: storagePath,
    edit_instruction: null, status: "COMPLETED", is_selected: true,
  };
}

function signedImage(path: string, signedUrl: string) {
  return { error: null, path, signedURL: signedUrl, signedUrl };
}
