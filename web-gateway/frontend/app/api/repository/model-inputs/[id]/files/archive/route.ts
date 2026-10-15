import { proxyArchive } from "@/lib/repository/files-proxy";

/** Entries of a folder of a published tree as one ZIP, for a form's POST: see `proxyArchive`. */

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;
  return proxyArchive(request, "model_input", id);
}
