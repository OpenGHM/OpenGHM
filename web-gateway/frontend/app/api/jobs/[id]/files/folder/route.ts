import { proxyRunFiles } from "@/lib/jobs/run-files-proxy";

/** What a folder of a run's output holds, and whether a ZIP of it is allowed: see `proxyRunFiles`. */

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;
  return proxyRunFiles(request, id, "folder");
}
