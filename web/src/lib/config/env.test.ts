import { afterEach, expect, it } from "vitest";
import { getMaintenanceEnv, getRunpodEnv, getSupabaseAdminEnv } from "@/lib/config/env";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

it("requires server-only credentials", () => {
  process.env = {
    ...ORIGINAL_ENV,
    NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "public",
  };
  delete process.env.SUPABASE_SECRET_KEY;
  expect(() => getSupabaseAdminEnv()).toThrow();
});

it("requires the Whisper endpoint exposed by the default capture mode", () => {
  process.env = {
    ...ORIGINAL_ENV, RUNPOD_API_KEY: "key", RUNPOD_ENDPOINT_ID: "flux",
    RUNPOD_PLANNER_ENDPOINT_ID: "planner",
  };
  delete process.env.RUNPOD_WHISPER_ENDPOINT_ID;
  expect(() => getRunpodEnv()).toThrow();
});

it("requires the dedicated planner endpoint", () => {
  process.env = { ...ORIGINAL_ENV, RUNPOD_API_KEY: "key", RUNPOD_ENDPOINT_ID: "flux" };
  delete process.env.RUNPOD_PLANNER_ENDPOINT_ID;
  expect(() => getRunpodEnv()).toThrow();
});

it("requires a strong cron secret", () => {
  process.env = { ...ORIGINAL_ENV, CRON_SECRET: "short" };
  expect(() => getMaintenanceEnv()).toThrow();
  process.env.CRON_SECRET = "c".repeat(32);
  expect(getMaintenanceEnv()).toEqual({ cronSecret: "c".repeat(32) });
});
