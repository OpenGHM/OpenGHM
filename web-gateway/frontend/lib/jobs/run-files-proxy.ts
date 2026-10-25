import { BACKEND_URL, getBackendAuth } from "@/lib/api-client";
import { proxyRefusal } from "@/lib/repository/output-proxy";
import { readSelection, relay, SELECTION_MESSAGE, UNREACHABLE } from "@/lib/repository/files-proxy";

/**
 * Shared by the routes under `app/api/jobs/[id]/files` (ADR 0040): `list`, one folder of a run's
 * output on Anvil scratch, `folder`, what a folder holds and whether a ZIP of it is allowed, and
 * `archive`, the entries ticked in the browser as one ZIP. The browser never calls FastAPI. Unlike
 * a published tree's, these are for the run's owner (and staff): the session's token goes with the
 * call, and a refusal (404, 409 `run_not_finished`, 410 `output_purged`, 413 `selection_too_large`,
 * 429 `archive_busy`, 503) comes back unchanged, status and JSON.
 */

type Route = "list" | "folder" | "archive";

const QUERY: Record<Route, string[]> = { list: ["path", "cursor"], folder: ["path"], archive: [] };

/** The backend's address for the run's files, for the job `id` and `route`. */
function target(id: string, route: Route, from: URLSearchParams): string {
  const base = `${BACKEND_URL}/api/v1/jobs/${encodeURIComponent(id)}/files`;
  const query = new URLSearchParams();
  for (const name of QUERY[route]) {
    const value = from.get(name);
    if (value !== null) query.set(name, value);
  }
  const path = route === "list" ? "" : `/${route}`;
  return query.size > 0 ? `${base}${path}?${query}` : `${base}${path}`;
}

export async function proxyRunFiles(request: Request, id: string, route: Route): Promise<Response> {
  const { headers, authenticated } = await getBackendAuth();
  if (!authenticated) return proxyRefusal(401, "session_expired", "Your session has expired. Sign in again.");

  const init: RequestInit = { headers, cache: "no-store", signal: request.signal };
  if (route === "archive") {
    const selection = await readSelection(request);
    if (!selection) return proxyRefusal(422, "invalid_selection", SELECTION_MESSAGE);
    init.method = "POST";
    init.headers = { ...headers, "Content-Type": "application/json" };
    init.body = JSON.stringify(selection);
  }
  try {
    // The body is the backend's own stream, passed on as it arrives: never buffered here.
    return relay(await fetch(target(id, route, new URL(request.url).searchParams), init), route === "archive");
  } catch {
    return proxyRefusal(502, "gateway_unreachable", UNREACHABLE);
  }
}
