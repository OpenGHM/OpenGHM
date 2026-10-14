import { BACKEND_URL } from "@/lib/api-client";
import { SNAPSHOT_ID, proxyRefusal as json } from "@/lib/repository/output-proxy";

/**
 * Downloads one variable of a published snapshot's output over a period and
 * a box, as NetCDF (ADR 0033). The backend has the toolkit cut it on Anvil
 * and streams the file; this route passes the body through as it arrives, so
 * the browser never calls FastAPI. Only the subset's own parameters are
 * passed on. A refusal (422 `output_request_refused` with the toolkit's
 * message: a period or box too large to read, a missing year) comes back
 * unchanged, status and JSON.
 */

const PARAMS = ["variable", "resolution", "start", "end", "bbox"] as const;

// Each answer is cut for the request; never cache it.
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;
  if (!SNAPSHOT_ID.test(id)) return json(404, "dataset_not_found", "There is no such snapshot.");

  const asked = new URL(request.url).searchParams;
  const query = new URLSearchParams();
  for (const name of PARAMS) {
    const value = asked.get(name);
    if (value) query.set(name, value);
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${BACKEND_URL}/api/v1/repository/datasets/${id}/output/subset?${query}`, {
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
    for (const name of ["content-disposition", "content-length"]) {
      const value = upstream.headers.get(name);
      if (value) out.set(name, value);
    }
  }
  out.set("Cache-Control", "no-store");
  return new Response(upstream.body, { status: upstream.status, headers: out });
}
