import { redirect, notFound } from "next/navigation";
import { pathWithQuery } from "@/lib/auth-redirect";
import { redirectToSignIn, requireSession } from "@/lib/auth-guard";
import Link from "next/link";
import { Header } from "@/components/landing/header";
import { Footer } from "@/components/landing/footer";
import { Button } from "@/components/ui/button";
import { PublishForm } from "@/components/workspace/publish-form";
import { fetchJob } from "@/lib/jobs/actions";
import { fakeSimulation } from "@/lib/workspace/fixtures";
import { resolvePreviewStatus } from "@/lib/workspace/preview";
import { ArrowLeft } from "lucide-react";

export default async function PublishJobPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const here = pathWithQuery(`/workspace/${encodeURIComponent(id)}/publish`, query);
  await requireSession(here);

  const previewRaw = Array.isArray(query.preview) ? query.preview[0] : query.preview;
  const previewStatus = resolvePreviewStatus(previewRaw);

  let job;
  if (previewStatus) {
    job = fakeSimulation(previewStatus, { id });
  } else {
    const result = await fetchJob(id);
    if (!result.ok) {
      if (result.reason === "session_expired") redirectToSignIn(here);
      if (result.reason === "not_found") notFound();
      throw new Error(result.message);
    }
    job = result.data;
  }

  // Publishing only makes sense once a run has actually finished.
  if (job.status !== "COMPLETED") redirect(`/workspace/${id}`);

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <div className="border-b bg-muted/50">
        <div className="mx-auto max-w-[840px] px-10 py-3 text-sm text-muted-foreground">
          <Link href={`/workspace/${id}${previewStatus ? `?preview=${previewStatus}` : ""}`} className="transition-colors hover:text-foreground">
            {job.sim_id || job.id.slice(0, 8)}
          </Link>
          <span className="mx-2">/</span>
          <span className="text-foreground">Publish as Snapshot</span>
        </div>
      </div>

      <main className="flex-1 bg-slate-50">
        <div className="mx-auto max-w-[840px] px-10 py-10">
          <div className="mb-6">
            <Button variant="ghost" size="sm" asChild>
              <Link href={`/workspace/${id}${previewStatus ? `?preview=${previewStatus}` : ""}`}>
                <ArrowLeft className="mr-1.5 size-4" />
                Back to Simulation
              </Link>
            </Button>
          </div>
          <h1 className="mb-1 text-2xl font-bold text-foreground">Publish as a Snapshot</h1>
          <p className="mb-6 text-sm text-muted-foreground">
            Turns this finished run into a published, citable snapshot.
          </p>
          <PublishForm job={job} />
        </div>
      </main>
      <Footer />
    </div>
  );
}
