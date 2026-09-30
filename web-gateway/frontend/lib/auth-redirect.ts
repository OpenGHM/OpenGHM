/**
 * Pure helpers for the sign-in round trip. No imports from next-auth, so the
 * proxy, server components and client components can all use them.
 */

/** `/auth/signin?callbackUrl=<path+query>` — where a signed-out visitor goes. */
export function signInPath(pathWithQuery: string): string {
  return `/auth/signin?callbackUrl=${encodeURIComponent(pathWithQuery)}`;
}

/**
 * A `callbackUrl` is attacker-controllable (it arrives in a link), so only a
 * same-origin relative path is honoured. It must start with a single "/":
 * "//host" and "/\host" are protocol-relative URLs to a browser, and control
 * characters can smuggle one past a naive prefix check.
 */
export function safeCallbackUrl(
  raw: string | null | undefined,
  fallback: string = "/"
): string {
  if (!raw) return fallback;
  if (!raw.startsWith("/")) return fallback;
  if (raw.startsWith("//") || raw.startsWith("/\\")) return fallback;
  if (/[\u0000-\u001f\u007f]/.test(raw)) return fallback;
  return raw;
}

/** Rebuilds "path?query" from a page's `searchParams` prop, keeping repeats. */
export function pathWithQuery(
  path: string,
  searchParams: Record<string, string | string[] | undefined> = {}
): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) qs.append(key, v);
  }
  const query = qs.toString();
  return query ? `${path}?${query}` : path;
}
