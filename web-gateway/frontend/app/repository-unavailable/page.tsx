import type { Metadata } from "next";
import Link from "next/link";
import { Database } from "lucide-react";
import { Footer } from "@/components/landing/footer";
import { PageBody } from "@/components/layout/page-hero";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/workspace/page-header";

export const metadata: Metadata = { title: "Data Repository | OpenGHM" };

/**
 * What every `/repository` address shows while the Data Repository is off
 * (lib/features.ts): proxy.ts rewrites to this page, so the repository's own
 * pages are not rendered at all.
 */
export default function RepositoryUnavailablePage() {
  return (
    <div className="flex min-h-screen flex-col">
      <PageHeader eyebrow="Data Repository" title="Data Repository" />
      <PageBody className="flex-1">
        <section aria-labelledby="repository-unavailable-title">
          <Card className="items-center gap-3.5 border-0 px-6 py-14 text-center shadow-raised sm:py-16">
            <span
              aria-hidden="true"
              className="grid size-[52px] place-items-center rounded-2xl bg-secondary text-primary [&_svg]:size-5"
            >
              <Database />
            </span>
            <h2 id="repository-unavailable-title" className="text-xl font-[650] tracking-[-0.01em] text-foreground">
              The Data Repository is coming soon
            </h2>
            <p className="max-w-md text-sm text-muted-foreground text-pretty">
              Browsing and downloading published snapshots and model inputs is not available on this
              site yet.
            </p>
            <Button asChild size="lg" className="mt-2">
              <Link href="/community">Visit the Community</Link>
            </Button>
          </Card>
        </section>
      </PageBody>
      <Footer />
    </div>
  );
}
