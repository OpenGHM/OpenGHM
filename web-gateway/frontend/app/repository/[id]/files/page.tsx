import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getDataset } from "@/lib/repository/detail-data";
import { PageBody } from "@/components/layout/page-hero";
import { Footer } from "@/components/landing/footer";
import { Button } from "@/components/ui/button";
import { DetailHero } from "@/components/repository/detail-hero";
import { TreeBrowser } from "@/components/repository/tree-browser";
import { ClampedName } from "@/components/common/clamped-name";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const dataset = await getDataset(id);
  return { title: dataset ? `Files of ${dataset.about.name} | OpenGHM` : "Snapshot not found | OpenGHM" };
}

export default async function DatasetFilesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const dataset = await getDataset(id);
  if (!dataset) notFound();
  const { name } = dataset.about;

  return (
    <>
      <DetailHero
        kind="snapshot"
        name={name}
        breadcrumb={[{ label: name, href: `/repository/${id}` }, { label: "Files" }]}
        title={
          <ClampedName lines={3} title={`Files of ${name}`}>
            Files <span className="font-normal text-hero-foreground-muted">of {name}</span>
          </ClampedName>
        }
        actions={
          <Button variant="on-dark" size="xl" asChild>
            <Link href={`/repository/${id}`}>
              <ArrowLeft aria-hidden="true" />
              Back to snapshot
            </Link>
          </Button>
        }
      />

      <PageBody>
        <Suspense>
          <TreeBrowser kind="snapshot" id={id} name={name} />
        </Suspense>
      </PageBody>

      <Footer />
    </>
  );
}
