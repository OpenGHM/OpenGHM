import { NextResponse } from "next/server";

/**
 * Same-origin passthrough to the backend's unauthenticated auth endpoints.
 *
 * These five are the only backend calls a browser makes. Every other page
 * fetches through lib/api-client.ts on the server, because FastAPI has no
 * Ingress and BACKEND_URL is a ClusterIP name (see
 * devdocs/architecture/gateway.md). These five could not do that: they run
 * before there is a session, so they were written as client-side fetches
 * against NEXT_PUBLIC_BACKEND_URL — a variable Next.js inlines at
 * `next build`, which meant one image could not serve two environments and,
 * in practice, meant the deployed bundle carried the localhost default and
 * registration / password reset reached nothing.
 *
 * Routing them through here removes the variable instead of plumbing a build
 * arg for it: the browser calls its own origin, this handler calls the
 * backend with the server-side BACKEND_URL, and the same image works in every
 * environment.
 *
 * ALLOWED is an allowlist, not a prefix match — this must never become a
 * general proxy into an API whose other routes expect an Authorization header
 * the browser does not have.
 */
const ALLOWED = new Set([
  "register",
  "verify-email",
  "forgot-password",
  "reset-password",
  "confirm-link",
]);

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8100";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ action: string }> }
) {
  const { action } = await params;

  if (!ALLOWED.has(action)) {
    return NextResponse.json({ detail: "Not found" }, { status: 404 });
  }

  let body: string;
  try {
    body = await request.text();
  } catch {
    return NextResponse.json({ detail: "Invalid request body" }, { status: 400 });
  }

  let res: Response;
  try {
    res = await fetch(`${BACKEND_URL}/api/v1/auth/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      cache: "no-store",
    });
  } catch {
    // The backend is unreachable — distinct from a 4xx it returned itself.
    // The pages surface this as "unable to connect".
    return NextResponse.json({ detail: "Backend unreachable" }, { status: 502 });
  }

  // Status and body pass through verbatim: the pages branch on 409 (email
  // already taken) and on the `link_pending` payload, so neither may be
  // reshaped here.
  const text = await res.text();
  return new NextResponse(text, {
    status: res.status,
    headers: {
      "Content-Type": res.headers.get("Content-Type") ?? "application/json",
    },
  });
}
