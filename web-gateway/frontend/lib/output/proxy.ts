import { BACKEND_URL, getBackendAuth } from "@/lib/api-client";
import { SNAPSHOT_ID, proxyRefusal } from "@/lib/repository/output-proxy";

/**
 * The output routes of a run (`/api/jobs/[id]/output...`, its owner only) and of
 * a published snapshot (`/api/repository/datasets/[id]/output...`, open) are one
 * proxy to the backend's `/output...` routes (ADR 0033). The browser never calls
 * FastAPI. Only each route's own query parameters are passed on; the backend's
 * refusals (404 `output_missing`, 410 `output_purged`, 422
 * `output_request_refused`, 503 ...) come back unchanged, status and JSON.
 */

export type OutputKind = "job" | "dataset";
export type OutputRoute = "inventory" | "map" | "series" | "subset";

const QUERY: Record<OutputRoute, readonly string[]> = {
  inventory: [],
  map: ["variable", "resolution", "start", "bbox", "width", "height", "ramp", "min", "max", "log"],
  series: ["variable", "resolution", "point", "start", "end", "display"],
  subset: ["variable", "resolution", "start", "end", "bbox"],
};

export async function proxyOutput(
  request: Request,
  kind: OutputKind,
  id: string,
  route: OutputRoute
): Promise<Response> {
  let headers: HeadersInit | undefined;
  if (kind === "dataset") {
    if (!SNAPSHOT_ID.test(id)) return proxyRefusal(404, "dataset_not_found", "There is no such snapshot.");
  } else {
    const auth = await getBackendAuth();
    if (!auth.authenticated) return proxyRefusal(401, "session_expired", "Your session has expired. Sign in again.");
    headers = auth.headers;
  }

  const asked = new URL(request.url).searchParams;
  const query = new URLSearchParams();
  for (const name of QUERY[route]) {
    const value = asked.get(name);
    if (value) query.set(name, value);
  }
  // The map card needs the legend with the image.
  if (route === "map") query.set("encoding", "json");

  const base =
    kind === "job"
      ? `${BACKEND_URL}/api/v1/jobs/${encodeURIComponent(id)}/output`
      : `${BACKEND_URL}/api/v1/repository/datasets/${id}/output`;
  const path = route === "inventory" ? "" : `/${route}`;
  const search = query.size > 0 ? `?${query}` : "";

  let upstream: Response;
  try {
    upstream = await fetch(`${base}${path}${search}`, { headers, cache: "no-store", signal: request.signal });
  } catch {
    return proxyRefusal(502, "gateway_unreachable", "The gateway could not reach its backend. Try again in a moment.");
  }

  const out = new Headers();
  const contentType = upstream.headers.get("content-type");
  if (contentType) out.set("Content-Type", contentType);
  if (upstream.ok && route === "subset") {
    for (const name of ["content-disposition", "content-length"]) {
      const value = upstream.headers.get(name);
      if (value) out.set(name, value);
    }
  }
  // A published snapshot's output does not change; a run's may, and a refusal may not last.
  const keep = upstream.ok && kind === "dataset" && route !== "subset";
  out.set("Cache-Control", keep ? "public, max-age=3600" : "no-store");
  return new Response(upstream.body, { status: upstream.status, headers: out });
}
