import { Suspense } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { fetchDatasetById } from "@/lib/repository/actions";
import { PageBody } from "@/components/layout/page-hero";
import { Footer } from "@/components/landing/footer";
import { Button } from "@/components/ui/button";
import { DetailHero } from "@/components/repository/detail-hero";
import { TreeBrowser } from "@/components/repository/tree-browser";
import { ClampedName } from "@/components/common/clamped-name";

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
