import { auth } from "@/lib/auth";
import { BACKEND_URL, getBackendAuth } from "@/lib/api-client";
import { MAX_UPLOAD_BYTES } from "@/lib/community/admin-format";

/**
 * Uploads a file to the Community media library. A server action cannot carry
 * a 25 MiB multipart body, so this route handler passes the request body on to
 * the backend as it arrives; the browser never calls FastAPI. The backend
 * decides what may be stored (413 over the limit, 415 for a type it does not
 * allow) and its answer, status and JSON, comes back unchanged. The route
 * refuses early only what it can see: no session (401), a signed-in account
 * that is not an admin (403), and a body that says it is over the limit (413).
 */

export const dynamic = "force-dynamic";

/** The multipart envelope around the file: boundaries and part headers. */
const ENVELOPE_ALLOWANCE = 64 * 1024;

function json(status: number, code: string, message: string): Response {
  return Response.json({ code, message }, { status });
}

export async function POST(request: Request): Promise<Response> {
  const session = await auth();
  const { headers, authenticated } = await getBackendAuth();
  if (!authenticated) {
    return json(401, "session_expired", "Your session has expired. Sign in again.");
  }
  if (session?.user?.role !== "admin") {
    return json(403, "permission_required", "Only admins can upload files.");
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    return json(415, "unsupported_media_type", "Send the file as multipart form data.");
  }
  const length = Number(request.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_UPLOAD_BYTES + ENVELOPE_ALLOWANCE) {
    return json(413, "file_too_large", "That file is over the 25 MiB limit.");
  }
  if (!request.body) return json(400, "empty_upload", "No file was sent.");

  let upstream: Response;
  try {
    upstream = await fetch(`${BACKEND_URL}/api/v1/admin/community/files`, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": contentType,
        ...(Number.isFinite(length) && length > 0 ? { "Content-Length": String(length) } : {}),
      },
      body: request.body,
      // Node's fetch needs this to send a stream.
      duplex: "half",
      cache: "no-store",
      signal: request.signal,
    } as RequestInit & { duplex: "half" });
  } catch {
    return json(502, "gateway_unreachable", "The gateway could not reach its backend. Try again in a moment.");
  }

  const out = new Headers();
  out.set("Content-Type", upstream.headers.get("content-type") ?? "application/json");
  out.set("Cache-Control", "no-store");
  return new Response(upstream.status === 204 ? null : upstream.body, { status: upstream.status, headers: out });
}
