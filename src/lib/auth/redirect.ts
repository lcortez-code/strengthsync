/** Accept only same-origin absolute paths for client-side navigation after sign-in. */
export function safeAuthCallback(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(value)) return "/dashboard";
  try {
    const base = "https://callback.invalid";
    const url = new URL(value, base);
    return url.origin === base ? url.pathname + url.search + url.hash : "/dashboard";
  } catch { return "/dashboard"; }
}
