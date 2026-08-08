import { z } from "zod";

const DEFAULT_KONTEXT_ENDPOINT_ID = "black-forest-labs-flux-1-kontext-dev";

const publicSchema = z.object({
  url: z.url(),
  publishableKey: z.string().min(1),
});

const adminSchema = publicSchema.extend({
  secretKey: z.string().min(1),
});

const runpodSchema = z.object({
  apiKey: z.string().min(1),
  fluxEndpointId: z.string().min(1),
  plannerEndpointId: z.string().min(1),
  kontextEndpointId: z.string().min(1),
  whisperEndpointId: z.string().min(1),
});

const maintenanceSchema = z.object({ cronSecret: z.string().min(32) });

export type SupabaseAdminEnv = z.infer<typeof adminSchema>;
export type SupabasePublicEnv = z.infer<typeof publicSchema>;
export type RunpodEnv = z.infer<typeof runpodSchema>;
export type MaintenanceEnv = z.infer<typeof maintenanceSchema>;

export function getSupabasePublicEnv(): SupabasePublicEnv {
  return publicSchema.parse({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    publishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
}

export function getSupabaseAdminEnv(): SupabaseAdminEnv {
  return adminSchema.parse({ ...getSupabasePublicEnv(), secretKey: process.env.SUPABASE_SECRET_KEY });
}

export function getRunpodEnv(): RunpodEnv {
  return runpodSchema.parse({
    apiKey: process.env.RUNPOD_API_KEY,
    fluxEndpointId: process.env.RUNPOD_ENDPOINT_ID,
    plannerEndpointId: process.env.RUNPOD_PLANNER_ENDPOINT_ID,
    kontextEndpointId: process.env.RUNPOD_KONTEXT_ENDPOINT_ID || DEFAULT_KONTEXT_ENDPOINT_ID,
    whisperEndpointId: process.env.RUNPOD_WHISPER_ENDPOINT_ID,
  });
}

export function getMaintenanceEnv(): MaintenanceEnv {
  return maintenanceSchema.parse({ cronSecret: process.env.CRON_SECRET });
}
