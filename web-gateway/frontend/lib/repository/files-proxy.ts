import { BACKEND_URL } from "@/lib/api-client";
import { MODEL_INPUT_ID, SNAPSHOT_ID, proxyRefusal } from "@/lib/repository/output-proxy";
import { treeRoute } from "@/lib/repository/tree-browse";
import type { TreeKind } from "@/lib/repository/types";

/**
 * Shared by the routes under `app/api/repository/{datasets,model-inputs}/[id]/files`
 * (ADR 0036): `folder`, what a folder holds and whether a ZIP of it is allowed,
 * and `archive`, the entries ticked in the browser as one ZIP. The browser
 * never calls FastAPI. A refusal (413 `selection_too_large`, 429 `archive_busy`,
 * 404, 422, 503) comes back unchanged, status and JSON.
 */

const UNREACHABLE = "The gateway could not reach its backend. Try again in a moment.";

function knownId(kind: TreeKind, id: string): boolean {
  return (kind === "snapshot" ? SNAPSHOT_ID : MODEL_INPUT_ID).test(id);
}

function relay(upstream: Response, download: boolean): Response {
  const out = new Headers();
  const contentType = upstream.headers.get("content-type");
  if (contentType) out.set("Content-Type", contentType);
  if (upstream.ok && download) {
    for (const name of ["content-disposition", "content-length"]) {
      const value = upstream.headers.get(name);
      if (value) out.set(name, value);
    }
  }
  out.set("Cache-Control", "no-store");
  // The body is the backend's own stream, passed on as it arrives: never buffered here.
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

/** `GET …/files/folder?path=`: only `path` is passed on. */
export async function proxyFolder(request: Request, kind: TreeKind, id: string): Promise<Response> {
  if (!knownId(kind, id)) return proxyRefusal(404, "not_found", "There is no such snapshot or model input.");
  const query = new URLSearchParams({ path: new URL(request.url).searchParams.get("path") ?? "" });
  try {
    return relay(await fetch(`${BACKEND_URL}${treeRoute(kind, id)}/files/folder?${query}`, {
      cache: "no-store",
      signal: request.signal,
    }), false);
  } catch {
    return proxyRefusal(502, "gateway_unreachable", UNREACHABLE);
  }
}

/**
 * `POST …/files/archive`: a form of `folder` and a `names` field for each entry
 * (or the same as JSON), forwarded to the backend as JSON. The ZIP comes back
 * with its name and exact length, so the browser shows real progress.
 */
export async function proxyArchive(request: Request, kind: TreeKind, id: string): Promise<Response> {
  if (!knownId(kind, id)) return proxyRefusal(404, "not_found", "There is no such snapshot or model input.");
  let folder: unknown;
  let names: unknown;
  try {
    if ((request.headers.get("content-type") ?? "").startsWith("application/json")) {
      ({ folder, names } = (await request.json()) as { folder?: unknown; names?: unknown });
    } else {
      const form = await request.formData();
      folder = form.get("folder") ?? "";
      names = form.getAll("names");
    }
  } catch {
    folder = undefined;
  }
  if (typeof folder !== "string" || !Array.isArray(names) || !names.every((n) => typeof n === "string")) {
    return proxyRefusal(422, "invalid_selection", "Send a folder and the names of its entries to download.");
  }
  try {
    return relay(
      await fetch(`${BACKEND_URL}${treeRoute(kind, id)}/files/archive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder, names }),
        cache: "no-store",
        // The browser leaving cancels the backend's reads of the bucket.
        signal: request.signal,
      }),
      true
    );
  } catch {
    return proxyRefusal(502, "gateway_unreachable", UNREACHABLE);
  }
}
