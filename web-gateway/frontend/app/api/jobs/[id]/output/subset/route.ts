import { proxyOutput } from "@/lib/output/proxy";

/** See `proxyOutput`. */
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;
  return proxyOutput(request, "job", id, "subset");
}
