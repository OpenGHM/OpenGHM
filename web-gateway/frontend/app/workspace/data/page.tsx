import { Suspense } from "react";
import { requireSession } from "@/lib/auth-guard";
import { Header } from "@/components/landing/header";
import { Footer } from "@/components/landing/footer";
import { MyDataSection } from "@/components/workspace/my-data-section";
import { MyDataSkeleton } from "@/components/workspace/my-data-states";
import { WorkspaceHero } from "@/components/workspace/workspace-hero";
import { MY_DATA_PATH } from "@/lib/workspace/my-data";

const HERE = MY_DATA_PATH;

export default async function MyDataPage() {
  await requireSession(HERE);

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1">
        <WorkspaceHero section="data" />

        <div className="bg-slate-50 px-4 py-6 sm:px-6 sm:py-8 lg:px-10">
          <div className="mx-auto max-w-[1024px]">
            <Suspense fallback={<MyDataSkeleton />}>
              <MyDataSection here={HERE} />
            </Suspense>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
