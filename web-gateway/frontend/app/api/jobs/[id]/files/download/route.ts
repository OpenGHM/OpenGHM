import { proxyRunFiles } from "@/lib/jobs/run-files-proxy";

/** One file of a run's output as it is, with its size: see `proxyRunFiles`. */

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;
  return proxyRunFiles(request, id, "download");
}
