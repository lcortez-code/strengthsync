import { randomBytes } from "crypto";

export function generateInviteCode(): string {
  return randomBytes(16).toString("hex").toUpperCase();
}
