import { afterEach, describe, expect, it } from "vitest";
import { getRunpodEnv, getSupabaseAdminEnv } from "@/lib/config/env";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("environment boundaries", () => {
  it("requires server-only credentials", () => {
    process.env = {
      ...ORIGINAL_ENV,
      NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "public",
    };
    delete process.env.SUPABASE_SECRET_KEY;
    expect(() => getSupabaseAdminEnv()).toThrow();
  });

  it("keeps the unprovisioned Whisper endpoint optional", () => {
    process.env = {
      ...ORIGINAL_ENV, RUNPOD_API_KEY: "key", RUNPOD_ENDPOINT_ID: "flux",
      RUNPOD_PLANNER_ENDPOINT_ID: "planner",
    };
    delete process.env.RUNPOD_WHISPER_ENDPOINT_ID;
    expect(getRunpodEnv()).toEqual({
      apiKey: "key",
      fluxEndpointId: "flux",
      plannerEndpointId: "planner",
      kontextEndpointId: "black-forest-labs-flux-1-kontext-dev",
      whisperEndpointId: undefined,
    });
  });

  it("requires the dedicated planner endpoint", () => {
    process.env = { ...ORIGINAL_ENV, RUNPOD_API_KEY: "key", RUNPOD_ENDPOINT_ID: "flux" };
    delete process.env.RUNPOD_PLANNER_ENDPOINT_ID;
    expect(() => getRunpodEnv()).toThrow();
  });
});
