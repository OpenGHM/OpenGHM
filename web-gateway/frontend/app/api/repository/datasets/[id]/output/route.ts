import { BACKEND_URL } from "@/lib/api-client";
import { SNAPSHOT_ID, proxyRefusal as json } from "@/lib/repository/output-proxy";

/**
 * A published snapshot's output inventory, for the subset dialog: what
 * variables, resolutions and years exist (the toolkit's `openghm output
 * inventory`, run on Anvil by the backend). The browser never calls FastAPI,
 * so this route passes the answer through. Open, like the snapshot's page;
 * the backend's own refusals (404, 503 `anvil_unreachable`, ...) come back
 * unchanged.
 */

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;
  if (!SNAPSHOT_ID.test(id)) return json(404, "dataset_not_found", "There is no such snapshot.");

  let upstream: Response;
  try {
    upstream = await fetch(`${BACKEND_URL}/api/v1/repository/datasets/${id}/output`, {
      cache: "no-store",
      signal: request.signal,
    });
  } catch {
    return json(502, "gateway_unreachable", "The gateway could not reach its backend. Try again in a moment.");
  }
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "application/json",
      // A published snapshot's output does not change; a refusal may not last.
      "Cache-Control": upstream.ok ? "public, max-age=3600" : "no-store",
    },
  });
}
