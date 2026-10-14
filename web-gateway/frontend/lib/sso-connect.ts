/**
 * The cookie that carries a "Connect CILogon" request across the CILogon round
 * trip. A server action sets it (lib/account/actions.ts `connectCilogon`) with
 * the token the backend minted, and the `signIn` callback in lib/auth.ts reads
 * it back when CILogon redirects the browser to the callback. A module of its
 * own because a "use server" file may only export async functions.
 */
export const SSO_CONNECT_COOKIE = "openghm_sso_connect";

/** Ten minutes, the same as the backend's intent (`pending_sso.CONNECT_EXPIRE`):
 *  a cookie that outlived the intent would only make a sign-in attempt fail. */
export const SSO_CONNECT_MAX_AGE_SECONDS = 600;

/**
 * The cookie names the account the intent was made for as well as the token,
 * and the callback acts on it only while that account is still the one signed
 * in. A cookie left behind by an abandoned Connect would otherwise attach the
 * next CILogon identity to sign in on this browser — after a sign-out, someone
 * else's — to the first account.
 */
export function connectCookieValue(userId: string, token: string): string {
  return `${userId}:${token}`;
}

export function readConnectCookie(value: string | undefined): { userId: string; token: string } | null {
  if (!value) return null;
  const at = value.lastIndexOf(":");
  if (at <= 0 || at === value.length - 1) return null;
  return { userId: value.slice(0, at), token: value.slice(at + 1) };
}
