#!/usr/bin/env node
import "reflect-metadata";

async function main() {
  if (process.argv.includes("--help")) {
    console.log("Provision a public read-only demo after migration 030 and the Guest-aware Nest entry are deployed.\nRequired environment: DATABASE_URL, LABRAT_GUEST_ADMIN_USERNAME, LABRAT_GUEST_PASSWORD.\nOptional: LABRAT_GUEST_USERNAME (guest), LABRAT_GUEST_LAB_SLUG (labrat-public-demo).\nNo real lab or account is adopted, overwritten or copied. The password is not printed.");
    return;
  }
  if (!process.env.DATABASE_URL || !process.env.LABRAT_GUEST_ADMIN_USERNAME || !process.env.LABRAT_GUEST_PASSWORD) {
    throw new Error("DATABASE_URL, LABRAT_GUEST_ADMIN_USERNAME and LABRAT_GUEST_PASSWORD are required.");
  }
  const { DatabaseService } = await import("../dist-v1/v1/platform/database/database.service.js");
  const { provisionPublicGuest } = await import("../dist-v1/v1/identity/public-guest-provision.js");
  const database = new DatabaseService({ databaseUrl: process.env.DATABASE_URL });
  try {
    const result = await provisionPublicGuest(database, {
      username: process.env.LABRAT_GUEST_USERNAME || "guest",
      password: process.env.LABRAT_GUEST_PASSWORD,
      adminUsername: process.env.LABRAT_GUEST_ADMIN_USERNAME,
      labSlug: process.env.LABRAT_GUEST_LAB_SLUG,
    });
    console.log(JSON.stringify(result));
  } finally {
    await database.onModuleDestroy();
  }
}

main().catch((error) => {
  console.error(error?.name === "ApiError" ? error.message : "Guest provisioning failed; no credentials are printed. Check prerequisites and transaction status before retrying.");
  process.exitCode = 1;
});
