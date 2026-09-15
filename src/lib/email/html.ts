/** Escape untrusted values before inserting them into HTML text or quoted attributes. */
export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]!);
}

/** Only web URLs are allowed in email links and images. Relative assets need a trusted base. */
export function safeEmailUrl(value: string, base?: string): string {
  if (!value.trim()) return "";
  try {
    const url = new URL(value, base);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) {
      return "";
    }
    return url.href;
  } catch {
    return "";
  }
}
