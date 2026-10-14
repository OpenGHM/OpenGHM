import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import { signInPath } from "@/lib/auth-redirect";
import { siteFeatures } from "@/lib/features";

// "/dashboard" has no index page anymore — only its "/dashboard/profile"
// child route exists — but the prefix match below still protects it.
//
// "/workspace" is not here on purpose: a signed-out visitor opening it gets the
// Workspace's own "Sign in to use the Workspace" page rather than a redirect
// (components/workspace/sign-in-required.tsx, decided per page by
// `workspaceSession()` in lib/auth-guard.ts).
const PROTECTED_PATHS = ["/dashboard", "/admin"];

export default auth((req) => {
  const { pathname } = req.nextUrl;

  // While the Workspace is off every address under it shows one page that says
  // so, and none of its own pages run (lib/features.ts).
  if (!siteFeatures().workspace && (pathname === "/workspace" || pathname.startsWith("/workspace/"))) {
    return NextResponse.rewrite(new URL("/workspace-unavailable", req.nextUrl.origin));
  }

  const isProtected = PROTECTED_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`)
  );

  // `req.auth.error` is set when the backend token could not be refreshed
  // (lib/auth.ts); the cookie is alive but the session is effectively over.
  const signedOut = !req.auth || Boolean(req.auth.error);

  // A server action (polling, cancel, save) from a page that is already open
  // always reaches its action, whether the session expired (`req.auth.error`)
  // or is gone altogether (signed out in another tab): the action answers 401
  // as data and the page shows SessionExpiredBanner. Redirecting it would hand
  // the client an HTML sign-in page it cannot parse. The backend still
  // authorises every call, and the next page navigation redirects as usual
  // (or, under /workspace, shows the sign-in page).
  const isServerAction = req.headers.has("next-action");

  if (isProtected && signedOut && !isServerAction) {
    // Keep the query string: /admin/jobs?status=FAILED returns there.
    const target = pathname + req.nextUrl.search;
    return NextResponse.redirect(new URL(signInPath(target), req.nextUrl.origin));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|images).*)"],
};
