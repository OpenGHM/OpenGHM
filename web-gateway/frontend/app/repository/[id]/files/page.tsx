import { Suspense } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, FolderTree } from "lucide-react";
import { fetchDatasetById } from "@/lib/repository/actions";
import { Header } from "@/components/landing/header";
import { Footer } from "@/components/landing/footer";
import { Button } from "@/components/ui/button";
import { TreeBrowser } from "@/components/repository/tree-browser";
import { ClampedName } from "@/components/common/clamped-name";
import { heroTitleSize } from "@/components/repository/hero-title";

export default async function DatasetFilesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const dataset = await fetchDatasetById(id);
  if (!dataset) notFound();
  const { name } = dataset.about;

  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      {/* Breadcrumb */}
      <div className="bg-muted/50 border-b">
        <div className="mx-auto flex max-w-[1280px] items-center px-10 py-3 text-sm text-muted-foreground">
          <Link href="/repository" className="shrink-0 hover:text-foreground transition-colors">
            Data Repository
          </Link>
          <span className="mx-2 shrink-0">/</span>
          <Link href={`/repository/${id}`} className="min-w-0 hover:text-foreground transition-colors">
            <ClampedName lines={1}>{name}</ClampedName>
          </Link>
          <span className="mx-2 shrink-0">/</span>
          <span className="shrink-0 text-foreground">Files</span>
        </div>
      </div>

      {/* Hero Banner */}
      <div className="bg-gradient-to-r from-[#0a192f] to-[#006994] py-8">
        <div className="mx-auto max-w-[1280px] px-10">
          <div className="mb-3 flex items-center gap-3">
            <span className="rounded-full bg-white/15 px-3 py-0.5 text-xs font-semibold text-white">
              Model Snapshot
            </span>
          </div>
          <h1 className={`flex items-start gap-3 leading-tight font-bold text-balance text-white ${heroTitleSize(name)}`}>
            <FolderTree className="mt-0.5 size-7 shrink-0" aria-hidden="true" />
            <ClampedName lines={3} title={`Files of ${name}`}>
              Files <span className="font-normal text-white/80">of {name}</span>
            </ClampedName>
          </h1>
        </div>
      </div>

      <main className="flex-1 bg-slate-50">
        <div className="mx-auto max-w-[1280px] px-10 py-10">
          <div className="mb-6 flex items-center justify-between">
            <Button variant="ghost" size="sm" asChild>
              <Link href={`/repository/${id}`}>
                <ArrowLeft className="mr-1.5 size-4" />
                Back to snapshot
              </Link>
            </Button>
          </div>
          <Suspense>
            <TreeBrowser kind="snapshot" id={id} name={name} />
          </Suspense>
        </div>
      </main>

      <Footer />
    </div>
  );
}
