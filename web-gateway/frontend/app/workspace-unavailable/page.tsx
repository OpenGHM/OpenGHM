import type { Metadata } from "next";
import Link from "next/link";
import { Hammer } from "lucide-react";
import { Footer } from "@/components/landing/footer";
import { PageBody } from "@/components/layout/page-hero";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/workspace/page-header";

export const metadata: Metadata = { title: "Workspace | OpenGHM" };

/**
 * What every `/workspace` address shows while the Workspace is off
 * (lib/features.ts): proxy.ts rewrites to this page, so the Workspace's own
 * pages are not rendered at all.
 */
export default function WorkspaceUnavailablePage() {
  return (
    <div className="flex min-h-screen flex-col">
      <PageHeader eyebrow="Workspace" title="Workspace" />
      <PageBody className="flex-1">
        <section aria-labelledby="workspace-unavailable-title">
          <Card className="items-center gap-3.5 border-0 px-6 py-14 text-center shadow-raised sm:py-16">
            <span
              aria-hidden="true"
              className="grid size-[52px] place-items-center rounded-2xl bg-secondary text-primary [&_svg]:size-5"
            >
              <Hammer />
            </span>
            <h2 id="workspace-unavailable-title" className="text-xl font-[650] tracking-[-0.01em] text-foreground">
              The Workspace is coming soon
            </h2>
            <p className="max-w-md text-sm text-muted-foreground text-pretty">
              Running model snapshots with your own settings is not available on this site yet. The
              published snapshots and their output are in the Data Repository.
            </p>
            <Button asChild size="lg" className="mt-2">
              <Link href="/repository">Browse the Data Repository</Link>
            </Button>
          </Card>
        </section>
      </PageBody>
      <Footer />
    </div>
  );
}
