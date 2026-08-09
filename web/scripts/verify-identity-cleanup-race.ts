import { cleanup, createAdmin, createAnonymousUser, parseIntegrationEnv }
  from "./branch-recovery-fixture.ts";
import { assertRenewedIdentitySurvivesStaleCleanup } from "./identity-lifecycle-fixture.ts";

async function main(): Promise<void> {
  const env = parseIntegrationEnv();
  const admin = createAdmin(env);
  const userId = await createAnonymousUser(env);
  try {
    await assertRenewedIdentitySurvivesStaleCleanup(admin, userId);
    console.log("identity_cleanup_race status=COMPLETED");
  } finally {
    await cleanup(admin, userId, []);
  }
}

await main();
