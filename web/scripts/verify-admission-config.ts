import { z } from "zod";
import { assertNoError, createAdmin, parseIntegrationEnv } from "./branch-recovery-fixture.ts";

const dreamLimitsSchema = z.object({
  max_active_per_user: z.literal(2),
  max_user_hour: z.literal(6),
  max_user_branch_hour: z.literal(12),
  max_global_day: z.literal(100),
});
const identityLimitsSchema = z.object({
  max_user_hour: z.literal(6),
  max_global_day: z.literal(40),
});
const usageSchema = z.object({ used: z.number().int().nonnegative() }).nullable();

async function main(): Promise<void> {
  const admin = createAdmin(parseIntegrationEnv());
  const date = new Date().toISOString().slice(0, 10);
  const [dreamLimits, identityLimits, dreamUsage, identityUsage] = await Promise.all([
    admin.from("dream_quota_limits").select(
      "max_active_per_user,max_user_hour,max_user_branch_hour,max_global_day",
    ).eq("singleton", true).single(),
    admin.from("identity_quota_limits").select("max_user_hour,max_global_day")
      .eq("singleton", true).single(),
    admin.from("dream_global_daily_usage").select("used")
      .eq("bucket_date", date).maybeSingle(),
    admin.from("identity_global_daily_usage").select("used")
      .eq("bucket_date", date).maybeSingle(),
  ]);
  for (const result of [dreamLimits, identityLimits, dreamUsage, identityUsage]) {
    assertNoError(result.error);
  }
  const parsedDreamLimits = dreamLimitsSchema.parse(dreamLimits.data);
  const parsedIdentityLimits = identityLimitsSchema.parse(identityLimits.data);
  const dreamUsed = usageSchema.parse(dreamUsage.data)?.used ?? 0;
  const identityUsed = usageSchema.parse(identityUsage.data)?.used ?? 0;
  if (dreamUsed > parsedDreamLimits.max_global_day) throw new Error("Dream quota ledger exceeds its limit");
  if (identityUsed > parsedIdentityLimits.max_global_day) {
    throw new Error("Identity quota ledger exceeds its limit");
  }
  console.log(`admission_config status=COMPLETED date=${date} dream_slots=${dreamUsed}/100 photos=${identityUsed}/40`);
}

await main();
