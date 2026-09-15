import { createHash } from "node:crypto";

// Bind encrypted sessions to the credential that was verified at sign-in.
// Password changes invalidate the binding without storing credential material in the session API.
export function credentialVersion(passwordHash: string): string {
  return createHash("sha256").update(passwordHash).digest("hex");
}
