import { proxyFolder } from "@/lib/repository/files-proxy";

/** What a folder of a published tree holds, and whether its ZIP is allowed: see `proxyFolder`. */

// Each answer is read from the bucket for the request; never cache it.
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;
  return proxyFolder(request, "snapshot", id);
}
