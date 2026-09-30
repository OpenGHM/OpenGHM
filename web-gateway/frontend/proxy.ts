import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import { signInPath } from "@/lib/auth-redirect";

// "/dashboard" has no index page anymore — only its "/dashboard/profile"
// child route exists — but the prefix match below still protects it.
const PROTECTED_PATHS = ["/dashboard", "/workspace", "/admin"];

export default auth((req) => {
  const { pathname } = req.nextUrl;

  const isProtected = PROTECTED_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`)
  );

  // `req.auth.error` is set when the backend token could not be refreshed
  // (lib/auth.ts); the cookie is alive but the session is effectively over.
  const signedOut = !req.auth || Boolean(req.auth.error);

  // A server action (polling, cancel, save) from a page that is already open
  // must reach its action when the session has expired: the action answers 401
  // as data and the page shows SessionExpiredBanner. Redirecting it here would
  // hand the client an HTML sign-in page it cannot parse. The backend still
  // authorises every call, and the next page navigation redirects as usual.
  const isServerActionFromExpiredSession =
    req.headers.has("next-action") && Boolean(req.auth?.error);

  if (isProtected && signedOut && !isServerActionFromExpiredSession) {
    // Keep the query string: /workspace?status=FAILED returns there.
    const target = pathname + req.nextUrl.search;
    return NextResponse.redirect(new URL(signInPath(target), req.nextUrl.origin));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|images).*)"],
};
