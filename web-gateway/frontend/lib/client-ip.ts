/**
 * The address a request came from, out of its `X-Forwarded-For`, for the
 * backend's sign-in throttle (web-gateway/backend/app/core/login_throttle.py).
 * The backend has no Ingress, so the only address it can see is this server's;
 * the one that matters is the browser's, and only this process knows it.
 *
 * The last entry, not the first: each proxy appends the address it received
 * the request from, so the first is whatever the browser claimed and the last
 * is what the proxy next to this server saw.
 */
export function clientIp(forwardedFor: string | null | undefined): string | undefined {
  const last = forwardedFor?.split(",").pop()?.trim();
  return last ? last : undefined;
}
