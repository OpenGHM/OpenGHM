import { BACKEND_URL, getBackendAuth } from "@/lib/api-client";

/**
 * Downloads a job's whole log (ADR 0027). A server action cannot stream a
 * file, so this route handler proxies the backend's download and passes the
 * body through as it arrives; the browser never calls FastAPI. The backend
 * decides who may read the log and how large a file it will send: what it
 * refuses with (404 `log_missing`, 413 `log_too_large`, 502
 * `anvil_unreachable`) comes back unchanged, status and JSON.
 *
 * `?job=<number>` names the job of a simulation run by several (ADR 0037) whose
 * stdout or stderr is wanted; without it the backend reads the current job.
 * The `wbm` log is one file across jobs, so it is asked for without one.
 */

const STREAMS = new Set(["stdout", "stderr", "wbm"]);

// The file changes while a job runs; never cache the answer.
export const dynamic = "force-dynamic";

function json(status: number, code: string, message: string): Response {
  return Response.json({ code, message }, { status });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; stream: string }> }
): Promise<Response> {
  const { id, stream } = await params;

  if (!STREAMS.has(stream)) {
    return json(400, "invalid_stream", "The log must be one of stdout, stderr or wbm.");
  }

  // A job number is a whole number from 1; anything else is refused here
  // rather than put into the backend's address.
  const requested = new URL(request.url).searchParams.get("job");
  if (requested !== null && !/^[1-9]\d{0,5}$/.test(requested)) {
    return json(400, "invalid_job", "The job must be a whole number from 1.");
  }
  const job = stream === "wbm" ? null : requested;

  const { headers, authenticated } = await getBackendAuth();
  if (!authenticated) {
    return json(401, "session_expired", "Your session has expired. Sign in again.");
  }

  let upstream: Response;
  try {
    upstream = await fetch(
      `${BACKEND_URL}/api/v1/jobs/${encodeURIComponent(id)}/logs/${stream}/download${job ? `?job=${job}` : ""}`,
      { headers, cache: "no-store", signal: request.signal }
    );
  } catch {
    return json(502, "gateway_unreachable", "The gateway could not reach its backend. Try again in a moment.");
  }

  const out = new Headers();
  const contentType = upstream.headers.get("content-type");
  if (contentType) out.set("Content-Type", contentType);
  if (upstream.ok) {
    for (const name of ["content-disposition", "content-length"]) {
      const value = upstream.headers.get(name);
      if (value) out.set(name, value);
    }
  }
  out.set("Cache-Control", "no-store");

  return new Response(upstream.body, { status: upstream.status, headers: out });
}
