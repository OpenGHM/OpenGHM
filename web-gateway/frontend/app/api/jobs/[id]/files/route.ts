import { proxyRunFiles } from "@/lib/jobs/run-files-proxy";

/** One folder of a run's output on Anvil scratch (ADR 0040): see `proxyRunFiles`. */

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;
  return proxyRunFiles(request, id, "list");
}
