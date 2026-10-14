/** Shared by the output proxy routes under `app/api/repository/datasets/[id]/output`. */

/** A snapshot id is a SHA-256 in hex. Anything else is not one, and the backend is not asked. */
export const SNAPSHOT_ID = /^[0-9a-f]{64}$/;

export function proxyRefusal(status: number, code: string, message: string): Response {
  return Response.json({ code, message }, { status, headers: { "Cache-Control": "no-store" } });
}
