import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

// "/dashboard" has no index page anymore — only its "/dashboard/profile"
// child route exists — but the prefix match below still protects it.
const PROTECTED_PATHS = ["/dashboard", "/simulations", "/admin"];

export default auth((req) => {
  const { pathname } = req.nextUrl;

  const isProtected = PROTECTED_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`)
  );

  if (isProtected && !req.auth) {
    const signInUrl = new URL("/auth/signin", req.nextUrl.origin);
    signInUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(signInUrl);
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|images).*)"],
};
