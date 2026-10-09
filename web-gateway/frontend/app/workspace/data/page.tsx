import { Suspense } from "react";
import { requireSession } from "@/lib/auth-guard";
import { Header } from "@/components/landing/header";
import { Footer } from "@/components/landing/footer";
import { MyDataSection } from "@/components/workspace/my-data-section";
import { MyDataSkeleton } from "@/components/workspace/my-data-states";
import { WIDE_CONTAINER, WORKSPACE_MAIN } from "@/components/workspace/page-header";
import { WorkspaceHeader } from "@/components/workspace/workspace-header";
import { cn } from "@/lib/utils";
import { MY_DATA_PATH } from "@/lib/workspace/my-data";

const HERE = MY_DATA_PATH;

export default async function MyDataPage() {
  await requireSession(HERE);

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className={WORKSPACE_MAIN}>
        <WorkspaceHeader section="data" />

        <div className={cn(WIDE_CONTAINER, "flex-1 py-6 sm:py-8")}>
          <Suspense fallback={<MyDataSkeleton />}>
            <MyDataSection here={HERE} />
          </Suspense>
        </div>
      </main>
      <Footer />
    </div>
  );
}
