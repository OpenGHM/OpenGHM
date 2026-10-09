import { Suspense } from "react";
import { requireSession } from "@/lib/auth-guard";
import { Footer } from "@/components/landing/footer";
import { MyDataSection } from "@/components/workspace/my-data-section";
import { MyDataSkeleton } from "@/components/workspace/my-data-states";
import { PageBody } from "@/components/layout/page-hero";
import { WorkspaceHeader } from "@/components/workspace/workspace-header";
import { MY_DATA_PATH } from "@/lib/workspace/my-data";

const HERE = MY_DATA_PATH;

export default async function MyDataPage() {
  await requireSession(HERE);

  return (
    <div className="flex min-h-screen flex-col">
      <WorkspaceHeader section="data" />
      <PageBody className="flex-1">
        <Suspense fallback={<MyDataSkeleton />}>
          <MyDataSection here={HERE} />
        </Suspense>
      </PageBody>
      <Footer />
    </div>
  );
}
