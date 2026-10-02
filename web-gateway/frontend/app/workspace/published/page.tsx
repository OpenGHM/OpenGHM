import { Suspense } from "react";
import { requireSession } from "@/lib/auth-guard";
import { Header } from "@/components/landing/header";
import { Footer } from "@/components/landing/footer";
import { PublishedListSkeleton } from "@/components/workspace/published-list";
import { PublishedSection } from "@/components/workspace/published-section";
import { WorkspaceHero } from "@/components/workspace/workspace-hero";

const HERE = "/workspace/published";

export default async function PublishedPage() {
  await requireSession(HERE);

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1">
        <WorkspaceHero section="published" />

        <div className="bg-slate-50 px-4 py-6 sm:px-6 sm:py-8 lg:px-10">
          <div className="mx-auto max-w-[1024px]">
            <Suspense fallback={<PublishedListSkeleton />}>
              <PublishedSection here={HERE} />
            </Suspense>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
