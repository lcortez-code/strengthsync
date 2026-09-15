// Platform authority is an operator-managed list of immutable user IDs.
// Organization creation and unverified email addresses never grant this authority.
export function isPlatformAdmin(userId?: string): boolean {
  if (!userId) return false;
  return (process.env.STRENGTHSYNC_PLATFORM_ADMIN_USER_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    .includes(userId);
}
