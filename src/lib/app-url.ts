/** The app's public base URL, from configuration rather than the request's Host header. */
export function appUrl() {
  const base = process.env.BETTER_AUTH_URL?.trim();
  if (!base) throw new Error("BETTER_AUTH_URL is not set.");
  return base.replace(/\/+$/, "");
}
