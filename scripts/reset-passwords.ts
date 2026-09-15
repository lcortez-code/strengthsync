/**
 * Script to reset all user passwords to a specified value
 *
 * The password is read from RESET_PASSWORD_VALUE so it is never committed.
 * Set it for this one command only; do not add it to .env.
 *
 * Run with:
 *   RESET_PASSWORD_VALUE='<password>' npx tsx --env-file=.env scripts/reset-passwords.ts
 *
 * The loopback check is the same guard every db:* npm script uses, so this
 * script can only target the local Docker database.
 */

import { hash } from "bcryptjs";
import { PrismaClient } from "@prisma/client";

import { assertLocalDatabaseUrl } from "./assert-local-database.mjs";

const NEW_PASSWORD = process.env.RESET_PASSWORD_VALUE;

if (!NEW_PASSWORD || NEW_PASSWORD.length < 8 || Buffer.byteLength(NEW_PASSWORD, "utf8") > 72) {
  console.error(
    "RESET_PASSWORD_VALUE must be at least 8 characters and within 72 UTF-8 bytes. Set it for this command only, e.g.\n" +
      "  RESET_PASSWORD_VALUE='<password>' npx tsx --env-file=.env scripts/reset-passwords.ts"
  );
  process.exit(1);
}

try {
  assertLocalDatabaseUrl(process.env.DATABASE_URL);
} catch (error) {
  console.error(
    error instanceof Error
      ? error.message
      : "DATABASE_URL check failed; password reset was blocked."
  );
  process.exit(1);
}

const prisma = new PrismaClient();

async function resetAllPasswords(newPassword: string) {
  console.log("Starting password reset for all users...\n");

  // Hash the new password
  const passwordHash = await hash(newPassword, 12);
  console.log("Password hash generated from RESET_PASSWORD_VALUE");

  // Get count of users
  const userCount = await prisma.user.count();
  console.log(`Found ${userCount} users to update\n`);

  if (userCount === 0) {
    console.log("No users found. Exiting.");
    return;
  }

  // Update all users
  const result = await prisma.user.updateMany({
    data: {
      passwordHash,
      passwordResetToken: null,
      passwordResetExpires: null,
    },
  });

  console.log(`Successfully updated ${result.count} users.`);
  console.log("\nCredentials updated. Accounts still require their configured email verification before sign-in.");
}

resetAllPasswords(NEW_PASSWORD)
  .catch((error) => {
    console.error("Local password reset failed");
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
