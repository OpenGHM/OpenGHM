import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
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
  searchParams: Promise<{ preview?: string }>;
}) {
  const session = await auth();
  if (!session) redirect("/auth/signin");

  const { id } = await params;
  const { preview: previewRaw } = await searchParams;
  const previewStatus = resolvePreviewStatus(previewRaw);

  const job = previewStatus
    ? fakeSimulation(previewStatus, { id })
    : await fetchJob(id);
  if (!job) notFound();

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
