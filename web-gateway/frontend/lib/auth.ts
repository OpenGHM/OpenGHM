import NextAuth, { CredentialsSignin, type NextAuthConfig, type User } from "next-auth";
import type { JWT } from "next-auth/jwt";
import type { OIDCConfig } from "next-auth/providers";
import Credentials from "next-auth/providers/credentials";
import { cookies, headers } from "next/headers";
import "./auth.types";
import type { UserRole } from "./auth.types";
import { SSO_CONNECT_COOKIE, readConnectCookie } from "./sso-connect";

/**
 * Thrown by the "sso-complete" provider's authorize() when the backend
 * returns `link_pending` instead of tokens — the email the user typed in
 * matches an existing password account, so it can't be created/merged
 * without the user confirming ownership by email (see
 * web-gateway/backend/app/api/v1/auth.py's confirm-link mechanism). NextAuth surfaces
 * `code` as `result.error` from a client-side `signIn({redirect:false})`
 * call, letting the complete-profile page distinguish this from a plain
 * invalid/expired link.
 */
class LinkPendingSignin extends CredentialsSignin {
  code = "link_pending";
}

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8100";

// Refresh this many ms before the backend's stated expiry, so a request
// mid-flight doesn't race an access token that just went stale.
const REFRESH_SKEW_MS = 60_000;

// Mirrors backend REFRESH_TOKEN_EXPIRE_DAYS (web-gateway/backend/app/core/config.py).
// No shared config between the two apps, so this is a duplicated constant —
// keep it in sync if the backend value changes.
const REFRESH_TOKEN_EXPIRE_DAYS = 30;

type BackendAuthResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: { id: string; email: string; name: string; role: UserRole };
};

/** Mirrors backend SsoLoginResponse (web-gateway/backend/app/models/user.py). */
type SsoLoginResponse =
  | { status: "ok"; auth: BackendAuthResponse }
  | { status: "needs_completion"; completion_token: string }
  // The answer to a connect_token: the identity is now attached to the
  // signed-in user, and there are no tokens because they already have a session.
  | { status: "connected" };

/**
 * The subset of a NextAuth `User` that carries backend session data
 * through to the jwt() callback's `if (user)` branch — set by every sign-in
 * path (credentials, CILogon, and the sso-complete provider below) so jwt()
 * itself doesn't need to know which one ran.
 */
type BackendUser = User & {
  role: UserRole;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
};

interface CILogonProfile {
  sub: string;
  email?: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  // Present with scope org.cilogon.userinfo — the display name of the
  // user's identity provider, e.g. "Purdue University Main Campus". Not
  // every provider sets it (ORCID, Google, GitHub don't), hence optional.
  idp_name?: string;
}

/**
 * CILogon registration (done by the operator, outside this codebase, at
 * https://cilogon.org/oauth2/register — see
 * devdocs/reference/external-services.md): register a client with redirect
 * URI `<FRONTEND_URL>/api/auth/callback/cilogon` and
 * scope `openid email profile org.cilogon.userinfo`, then set
 * CILOGON_CLIENT_ID/CILOGON_CLIENT_SECRET here. Until those are set, this
 * is `undefined` and the provider list below simply omits CILogon —
 * existing credentials-only login is unaffected either way.
 */
function cilogonProvider(): OIDCConfig<CILogonProfile> | undefined {
  const clientId = process.env.CILOGON_CLIENT_ID;
  const clientSecret = process.env.CILOGON_CLIENT_SECRET;
  if (!clientId || !clientSecret) return undefined;

  return {
    id: "cilogon",
    name: "CILogon",
    type: "oidc",
    issuer: "https://cilogon.org",
    clientId,
    clientSecret,
    authorization: { params: { scope: "openid email profile org.cilogon.userinfo" } },
    profile(profile) {
      return {
        id: profile.sub,
        name: profile.name ?? `${profile.given_name ?? ""} ${profile.family_name ?? ""}`.trim(),
        email: profile.email,
      };
    },
  };
}

/**
 * Rotates the backend refresh token for a new access+refresh pair.
 * On any failure, returns the token annotated with `error` rather than
 * throwing — the session callback surfaces that so callers (e.g.
 * api-client.ts) can treat the session as effectively signed out instead of
 * attaching a dead Authorization header.
 */
async function refreshAccessToken(token: JWT): Promise<JWT> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/v1/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: token.refreshToken }),
    });
    if (!res.ok) throw new Error(`refresh failed: ${res.status}`);

    const data = (await res.json()) as BackendAuthResponse;
    return {
      ...token,
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      accessTokenExpires: Date.now() + data.expires_in * 1000 - REFRESH_SKEW_MS,
      error: undefined,
    };
  } catch {
    return { ...token, error: "RefreshAccessTokenError" as const };
  }
}

const cilogon = cilogonProvider();

/**
 * Whether CILogon sign-in is configured on this server. Decided here, on the
 * server, from the same variables that decide whether NextAuth lists the
 * provider, so a page can offer "Connect CILogon" without a round trip to ask.
 */
export const cilogonConfigured = cilogon !== undefined;

export const authConfig: NextAuthConfig = {
  providers: [
    Credentials({
      name: "Email & Password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, request) {
        if (!credentials?.email || !credentials?.password) return null;

        try {
          const res = await fetch(`${BACKEND_URL}/api/v1/auth/login`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              // Forward the browser's UA so the backend can label the
              // session (see app/core/sessions.py). This fetch originates
              // on the Next.js server, so without forwarding it the
              // backend would only ever see the Node runtime's UA and
              // every device would look identical in the session list.
              ...(request?.headers?.get("user-agent")
                ? { "User-Agent": request.headers.get("user-agent")! }
                : {}),
            },
            body: JSON.stringify({
              email: credentials.email,
              password: credentials.password,
            }),
          });

          if (!res.ok) return null;

          const data = (await res.json()) as BackendAuthResponse;
          return {
            id: data.user.id,
            email: data.user.email,
            name: data.user.name,
            role: data.user.role,
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            expiresIn: data.expires_in,
          } as BackendUser;
        } catch {
          return null;
        }
      },
    }),
    // Used only by /auth/complete-profile, after an SSO provider (ORCID,
    // typically) didn't release an email and the user has just typed one
    // in. Not shown as a sign-in option anywhere — see that page.
    Credentials({
      id: "sso-complete",
      name: "Complete sign-in",
      credentials: {
        completionToken: { label: "Token", type: "text" },
        email: { label: "Email", type: "email" },
        name: { label: "Name", type: "text" },
      },
      async authorize(credentials) {
        if (!credentials?.completionToken || !credentials?.email || !credentials?.name) {
          return null;
        }
        try {
          const res = await fetch(`${BACKEND_URL}/api/v1/auth/complete-sso-signup`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              completion_token: credentials.completionToken,
              email: credentials.email,
              name: credentials.name,
            }),
          });
          if (!res.ok) return null;

          const data = (await res.json()) as
            | BackendAuthResponse
            | { status: "link_pending"; email: string };
          if (!("access_token" in data)) {
            // No tokens to establish a session with — the email matched an
            // existing password account, and confirming the link requires
            // clicking the email that was just sent. Thrown outside any
            // catch that would otherwise swallow it back to a generic null.
            throw new LinkPendingSignin();
          }

          return {
            id: data.user.id,
            email: data.user.email,
            name: data.user.name,
            role: data.user.role,
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            expiresIn: data.expires_in,
          } as BackendUser;
        } catch (err) {
          if (err instanceof LinkPendingSignin) throw err;
          return null;
        }
      },
    }),
    ...(cilogon ? [cilogon] : []),
  ],

  callbacks: {
    async signIn({ user, account, profile }) {
      if (account?.provider !== "cilogon" || !profile) return true;

      // NextAuth has already verified the id_token against CILogon's JWKS
      // by this point (that's the OIDC client flow, handled entirely by
      // next-auth/providers/oauth) — this backend never sees or validates
      // that token. What it does need is a backend-format access+refresh
      // pair, so hand the now-trusted identity to POST /auth/sso-login.
      //
      // Done here in signIn() rather than jwt() so a result that is not a
      // session (`needs_completion`, `connected`, a refusal) can redirect the
      // browser to the page that explains it: jwt() has no way to redirect,
      // but returning a string URL from signIn() does exactly that.
      const cilogonProfile = profile as CILogonProfile;
      // Set once the cookie below names the signed-in user: from then on a
      // refusal goes back to the profile, not to the sign-in page.
      let connectToken: string | null = null;
      try {
        // This callback runs inside the OAuth callback request, so the
        // real browser's headers are available via next/headers even
        // though signIn() itself doesn't receive a Request object —
        // without forwarding it, the session would be tagged with the
        // Next.js server's own UA ("node") instead of the device that
        // signed in.
        const incomingUserAgent = (await headers()).get("user-agent");

        // A signed-in user who pressed "Connect CILogon" on their profile left
        // this cookie (lib/account/actions.ts `connectCilogon`). With it, this
        // CILogon sign-in is not a sign-in: the backend attaches the identity
        // to that user, whatever email CILogon gave. It counts only while the
        // account it names is still the one signed in (lib/sso-connect.ts);
        // otherwise this is an ordinary sign-in. Taken off the browser either
        // way so a retry cannot reuse it — the backend spends the intent
        // regardless, this only tidies up. A cookie store that refuses the
        // delete must not turn into a refused sign-in.
        const cookieStore = await cookies();
        const connect = readConnectCookie(cookieStore.get(SSO_CONNECT_COOKIE)?.value);
        if (connect) {
          try {
            cookieStore.delete(SSO_CONNECT_COOKIE);
          } catch {
            // Nothing to do: the intent is spent on the backend regardless.
          }
          if ((await auth())?.user?.id === connect.userId) connectToken = connect.token;
        }

        const res = await fetch(`${BACKEND_URL}/api/v1/auth/sso-login`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Internal-Auth": process.env.INTERNAL_SERVICE_SECRET ?? "",
            ...(incomingUserAgent ? { "User-Agent": incomingUserAgent } : {}),
          },
          body: JSON.stringify({
            email: cilogonProfile.email ?? null,
            name: cilogonProfile.name ?? null,
            external_id: account.providerAccountId,
            provider: "cilogon",
            organization: cilogonProfile.idp_name ?? null,
            connect_token: connectToken,
          }),
        });
        if (!res.ok) {
          // Returning a URL rather than false, because false lands on
          // NextAuth's generic error page, which cannot say why. Someone who
          // pressed a button on their profile goes back there; 409 is the
          // identity being held by another account.
          if (connectToken) {
            return res.status === 409
              ? "/dashboard/profile?sso=conflict"
              : "/dashboard/profile?sso=failed";
          }
          // A plain sign-in goes back to the sign-in page with the reason.
          // 401 is also what a wrong X-Internal-Auth gets, so only the
          // deactivated detail is named as such.
          const detail = ((await res.json().catch(() => null)) as { detail?: unknown } | null)
            ?.detail;
          if (res.status === 409) return "/auth/signin?sso=conflict";
          if (typeof detail === "string" && detail.includes("deactivated")) {
            return "/auth/signin?sso=deactivated";
          }
          return "/auth/signin?sso=failed";
        }

        const data = (await res.json()) as SsoLoginResponse;
        if (data.status === "needs_completion") {
          return `/auth/complete-profile?token=${encodeURIComponent(data.completion_token)}`;
        }
        if (data.status === "connected") {
          // Returning a URL from signIn() ends this OAuth callback before
          // NextAuth creates a session or touches the session cookie (see
          // handleAuthorized in @auth/core's lib/actions/callback/index.js,
          // which returns the redirect ahead of handleLoginOrRegister). The
          // session the user already had stays exactly as it was.
          return "/dashboard/profile?sso=connected";
        }

        // Stash the backend session onto `user` — NextAuth passes this
        // same object straight through to jwt() as its `user` argument on
        // this request, so jwt()'s one `if (user)` branch (shared with
        // both credentials providers above) picks it up without any
        // CILogon-specific code of its own.
        //
        // The id, name and email are the OpenGHM account's, not CILogon's: the
        // account is who signs in, CILogon is only how. Without them the
        // session would carry CILogon's name and address and a random id
        // (Auth.js has no adapter here to map the identity to a user), so the
        // header would name the CILogon identity while every page that asks
        // the backend shows the account it is connected to. Set on this same
        // object because Auth.js builds the session token's name, email and
        // sub from it after this callback returns.
        Object.assign(user, {
          id: data.auth.user.id,
          name: data.auth.user.name,
          email: data.auth.user.email,
          role: data.auth.user.role,
          accessToken: data.auth.access_token,
          refreshToken: data.auth.refresh_token,
          expiresIn: data.auth.expires_in,
        } satisfies Partial<BackendUser>);
        return true;
      } catch {
        // Network trouble or a cookie store that threw: say so where the
        // person is, as for any other refusal.
        return connectToken ? "/dashboard/profile?sso=failed" : "/auth/signin?sso=failed";
      }
    },
    async jwt({ token, user }) {
      // Initial sign-in: `user` is whatever authorize() (either
      // Credentials provider) or signIn() (CILogon) attached the backend
      // session to.
      if (user) {
        const u = user as BackendUser;
        token.role = u.role;
        token.id = user.id;
        token.accessToken = u.accessToken;
        token.refreshToken = u.refreshToken;
        token.accessTokenExpires = Date.now() + u.expiresIn * 1000 - REFRESH_SKEW_MS;
        return token;
      }

      // Subsequent calls: reuse the access token while it's still fresh.
      if (token.accessTokenExpires && Date.now() < token.accessTokenExpires) {
        return token;
      }

      // Expired (or no expiry recorded, e.g. a pre-refresh-token session) —
      // rotate it. If there's no refreshToken to rotate with, this call
      // fails fast and just sets `error`, same end state.
      return refreshAccessToken(token);
    },
    session({ session, token }) {
      session.user.role = token.role as UserRole;
      session.user.id = token.id as string;
      session.user.accessToken = token.accessToken as string;
      if (token.error) session.error = token.error;
      return session;
    },
  },

  pages: {
    signIn: "/auth/signin",
  },

  session: {
    strategy: "jwt",
    // Matches the backend refresh token's lifetime — once that's expired
    // there's nothing left to renew the session with anyway.
    maxAge: REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60,
  },
};

export const { handlers, signIn, signOut, auth } = NextAuth(authConfig);
