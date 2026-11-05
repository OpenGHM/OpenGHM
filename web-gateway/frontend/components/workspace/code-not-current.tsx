import Link from "next/link";
import { Footer } from "@/components/landing/footer";
import { PageBody } from "@/components/layout/page-hero";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader, draftBreadcrumb } from "@/components/workspace/page-header";
import { CircleAlert } from "lucide-react";

/**
 * What `/workspace/new/<snapshot id>` shows when the snapshot's WBM code is not
 * current (`wbm_code_not_current`): a pasted or stale link, or a button on a
 * page that has not caught up. The card says what the backend said, which is
 * already plain (the code's version, why it is refused and which versions a new
 * snapshot draft may start from), and leads back to the snapshot choice, which
 * offers only the snapshots that can start one.
 */
export function CodeNotCurrent({ datasetId, message }: { datasetId: string; message: string }) {
  return (
    <div className="flex min-h-screen flex-col">
      <PageHeader breadcrumb={draftBreadcrumb("New snapshot")} title="New snapshot" />
      <PageBody className="flex-1">
        <section aria-labelledby="code-not-current-title">
          <Card className="items-center gap-3.5 border-0 px-6 py-14 text-center shadow-raised sm:py-16">
            <span
              aria-hidden="true"
              className="grid size-[52px] place-items-center rounded-2xl bg-warning/10 text-warning [&_svg]:size-5"
            >
              <CircleAlert />
            </span>
            <h2 id="code-not-current-title" className="text-xl font-[650] tracking-[-0.01em] text-foreground">
              This model snapshot cannot start a new snapshot draft
            </h2>
            <p role="alert" className="max-w-md text-sm text-muted-foreground text-pretty">
              {message}
            </p>
            <Button asChild size="lg" className="mt-2">
              <Link href="/workspace/new">Choose another model snapshot</Link>
            </Button>
            <Button asChild variant="link" size="sm" className="min-h-10 text-muted-foreground">
              <Link href={`/repository/${encodeURIComponent(datasetId)}`}>View this model snapshot</Link>
            </Button>
          </Card>
        </section>
      </PageBody>
      <Footer />
    </div>
  );
}
