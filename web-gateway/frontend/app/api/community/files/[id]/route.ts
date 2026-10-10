import { BACKEND_URL } from "@/lib/api-client";

/**
 * Serves a file uploaded in the Community CMS (a cover, a photo, a handout).
 * Content stores the address `/api/community/files/<id>`; the browser never
 * calls FastAPI, so this route streams the backend's bytes through. Files are
 * public, so no session is sent. The backend names the type, whether the
 * browser shows the file or saves it, and how long it may be cached (an
 * upload never changes); all of that is passed on unchanged.
 */

/** A GridFS ObjectId. Anything else is not a file, and the backend is not asked. */
const FILE_ID = /^[0-9a-f]{24}$/;

function json(status: number, code: string, message: string): Response {
  return Response.json(
    { code, message },
    { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } }
  );
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;
  if (!FILE_ID.test(id)) return json(404, "file_not_found", "There is no such file.");

  let upstream: Response;
  try {
    upstream = await fetch(`${BACKEND_URL}/api/v1/community/files/${id}`, {
      cache: "no-store",
      signal: request.signal,
    });
  } catch {
    return json(502, "gateway_unreachable", "The gateway could not reach its backend. Try again in a moment.");
  }

  const out = new Headers();
  const contentType = upstream.headers.get("content-type");
  if (contentType) out.set("Content-Type", contentType);
  if (upstream.ok) {
    for (const name of ["content-disposition", "content-length", "cache-control"]) {
      const value = upstream.headers.get(name);
      if (value) out.set(name, value);
    }
  } else {
    // A refusal is never kept: the file may be uploaded a moment later.
    out.set("Cache-Control", "no-store");
  }
  out.set("X-Content-Type-Options", "nosniff");

  return new Response(upstream.body, { status: upstream.status, headers: out });
}
