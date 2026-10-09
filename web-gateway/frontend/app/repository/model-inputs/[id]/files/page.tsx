import { Suspense } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, FolderTree } from "lucide-react";
import { fetchModelInputById } from "@/lib/repository/actions";
import { Header } from "@/components/landing/header";
import { Footer } from "@/components/landing/footer";
import { Button } from "@/components/ui/button";
import { TreeBrowser } from "@/components/repository/tree-browser";

export default async function ModelInputFilesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const modelInput = await fetchModelInputById(id);
  if (!modelInput) notFound();
  const { name } = modelInput.about;

  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      {/* Breadcrumb */}
      <div className="bg-muted/50 border-b">
        <div className="mx-auto max-w-[1280px] px-10 py-3 text-sm text-muted-foreground">
          <Link href="/repository" className="hover:text-foreground transition-colors">
            Data Repository
          </Link>
          <span className="mx-2">/</span>
          <Link href={`/repository/model-inputs/${id}`} className="hover:text-foreground transition-colors">
            {name}
          </Link>
          <span className="mx-2">/</span>
          <span className="text-foreground">Files</span>
        </div>
      </div>

      {/* Hero Banner */}
      <div className="bg-gradient-to-r from-[#0a192f] to-[#00695c] py-8">
        <div className="mx-auto max-w-[1280px] px-10">
          <div className="mb-3 flex items-center gap-3">
            <span className="rounded-full bg-white/15 px-3 py-0.5 text-xs font-semibold text-white">
              Model Input
            </span>
          </div>
          <h1 className="flex items-center gap-3 text-2xl font-bold leading-tight text-white md:text-3xl">
            <FolderTree className="size-7 shrink-0" aria-hidden="true" />
            <span>
              Files <span className="font-normal text-white/80">of {name}</span>
            </span>
          </h1>
        </div>
      </div>

      <main className="flex-1 bg-slate-50">
        <div className="mx-auto max-w-[1280px] px-10 py-10">
          <div className="mb-6 flex items-center justify-between">
            <Button variant="ghost" size="sm" asChild>
              <Link href={`/repository/model-inputs/${id}`}>
                <ArrowLeft className="mr-1.5 size-4" />
                Back to model input
              </Link>
            </Button>
          </div>
          <Suspense>
            <TreeBrowser kind="model_input" id={id} name={name} />
          </Suspense>
        </div>
      </main>

      <Footer />
    </div>
  );
}
