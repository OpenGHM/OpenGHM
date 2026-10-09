import { Suspense } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { fetchModelInputById } from "@/lib/repository/actions";
import { PageBody } from "@/components/layout/page-hero";
import { Footer } from "@/components/landing/footer";
import { Button } from "@/components/ui/button";
import { DetailHero } from "@/components/repository/detail-hero";
import { TreeBrowser } from "@/components/repository/tree-browser";
import { ClampedName } from "@/components/common/clamped-name";

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
    <>
      <DetailHero
        kind="model-input"
        name={name}
        breadcrumb={[{ label: name, href: `/repository/model-inputs/${id}` }, { label: "Files" }]}
        title={
          <ClampedName lines={3} title={`Files of ${name}`}>
            Files <span className="font-normal text-hero-foreground-muted">of {name}</span>
          </ClampedName>
        }
        actions={
          <Button variant="on-dark" size="xl" asChild>
            <Link href={`/repository/model-inputs/${id}`}>
              <ArrowLeft aria-hidden="true" />
              Back to model input
            </Link>
          </Button>
        }
      />

      <PageBody>
        <Suspense>
          <TreeBrowser kind="model_input" id={id} name={name} />
        </Suspense>
      </PageBody>

      <Footer />
    </>
  );
}
