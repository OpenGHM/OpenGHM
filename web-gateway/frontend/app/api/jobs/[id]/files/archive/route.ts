import { proxyRunFiles } from "@/lib/jobs/run-files-proxy";

/** Entries of a folder of a run's output as one ZIP, for a form's POST: see `proxyRunFiles`. */

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;
  return proxyRunFiles(request, id, "archive");
}
