/** Only Microsoft-hosted Teams connectors and Workflows are valid destinations. */
export function isTeamsWebhookUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password ||
        (url.port && url.port !== "443") || url.hash) return false;
    const host = url.hostname.toLowerCase();
    return host === "outlook.office.com" ||
      host.endsWith(".webhook.office.com") ||
      host.endsWith(".logic.azure.com") ||
      host.endsWith(".environment.api.powerplatform.com");
  } catch {
    return false;
  }
}

export function getTeamsFallbackUrl(organizationId: string): string | null {
  if (process.env.TEAMS_WEBHOOK_ORGANIZATION_ID !== organizationId) return null;
  const url = process.env.TEAMS_WEBHOOK_URL;
  return isTeamsWebhookUrl(url) ? url : null;
}
