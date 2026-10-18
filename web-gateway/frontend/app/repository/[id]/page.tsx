import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getDataset, getModelInput } from "@/lib/repository/detail-data";
import { PageBody } from "@/components/layout/page-hero";
import { Footer } from "@/components/landing/footer";
import { Button } from "@/components/ui/button";
import { ComingSoonChip } from "@/components/ui/coming-soon-chip";
import { WhenWorkspace } from "@/components/site-features";
import { CitationCard } from "@/components/repository/citation-card";
import { DatasetJsonLd } from "@/components/repository/dataset-json-ld";
import { DetailHero, HeroChip } from "@/components/repository/detail-hero";
import { DetailSection } from "@/components/repository/detail-section";
import {
  ActiveProcessesSection,
  CreatorsSection,
  DescriptionSection,
  InfoSection,
  KeywordsSection,
  RelatedLinksSection,
  SpatialCoverageSection,
} from "@/components/repository/detail-parts";
import { DownloadSkeleton, SnapshotDownloadSection } from "@/components/repository/download-section";
import { ExecutionCard } from "@/components/repository/execution-card";
import { OutputVariablesTable } from "@/components/repository/output-variables-table";
import { newStepHref } from "@/lib/workspace/draft-wizard";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const dataset = await getDataset(id);
  return { title: dataset ? `${dataset.about.name} | OpenGHM` : "Snapshot not found | OpenGHM" };
}

export default async function DatasetDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const dataset = await getDataset(id);
  if (!dataset) notFound();

  const { about, simulation, uses, runtime } = dataset;
  // The snapshot links its model input by id. Show the catalogue's name and
  // link to its page when the catalogue holds it; a lookup failure only
  // costs the name, never the page.
  const modelInputId = uses.modelInput.id;
  const modelInput = await getModelInput(modelInputId).catch(() => null);
  const temporalLabel = `${simulation.temporalCoverage.start} – ${simulation.temporalCoverage.end}`;
  const resolutionLabel = `${simulation.resolution.value} ${simulation.resolution.unit}`;

  return (
    <>
      <DatasetJsonLd dataset={dataset} />
      <DetailHero
        kind="snapshot"
        name={about.name}
        tags={about.tags}
        breadcrumb={[{ label: about.name }]}
        timeline={simulation.temporalCoverage}
        chips={
          <>
            <HeroChip label="Coverage">{temporalLabel}</HeroChip>
            <HeroChip label="Resolution">{resolutionLabel}</HeroChip>
          </>
        }
        actions={
          <>
            <Button variant="on-dark" size="xl" asChild>
              <Link href="/repository">
                <ArrowLeft aria-hidden="true" />
                Back to Data Repository
              </Link>
            </Button>
            <WhenWorkspace
              off={
                <Button
                  variant="on-dark"
                  size="xl"
                  disabled
                  className="h-auto flex-col items-start justify-center gap-px py-2 disabled:opacity-100"
                >
                  <span className="flex items-center gap-2 text-[11.5px] font-normal text-white/60">
                    Start a new snapshot draft from it
                    <ComingSoonChip tone="dark" />
                  </span>
                  <span className="opacity-60">Run this snapshot</span>
                </Button>
              }
            >
              <Button
                size="xl"
                asChild
                className="h-auto flex-col items-start justify-center gap-px py-2 shadow-float"
              >
                <Link href={newStepHref(dataset.id, "run")}>
                  <span className="text-[11.5px] font-normal text-white/80">
                    Start a new snapshot draft from it
                  </span>
                  Run this snapshot →
                </Link>
              </Button>
            </WhenWorkspace>
          </>
        }
      />

      <PageBody>
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
          {/* Left column */}
          <div className="flex min-w-0 flex-col gap-4">
            <DescriptionSection description={about.description} />

            <SpatialCoverageSection
              north={simulation.spatialCoverage.northlimit}
              south={simulation.spatialCoverage.southlimit}
              east={simulation.spatialCoverage.eastlimit}
              west={simulation.spatialCoverage.westlimit}
              projection={simulation.spatialCoverage.projection}
            />

            {simulation.outputVariables.length > 0 && (
              <DetailSection
                title="Output Variables"
                aside={
                  <span className="font-mono text-xs text-muted-foreground">
                    {simulation.outputVariables.length} configured
                  </span>
                }
              >
                <p className="text-[13.5px] leading-relaxed text-pretty text-muted-foreground">
                  The variables this run was configured to write. The output files can hold more: a variable written
                  per mask, such as dischMsk, appears there once for each mask (dischMsk_1, dischMsk_4, …).
                </p>
                <OutputVariablesTable variables={simulation.outputVariables} />
              </DetailSection>
            )}

            {simulation.activeProcesses.length > 0 && (
              <ActiveProcessesSection processes={simulation.activeProcesses} />
            )}

            {about.relatedLink && about.relatedLink.length > 0 && (
              <RelatedLinksSection links={about.relatedLink} />
            )}

            {/* Citation — the catalogue card's Cite link lands here */}
            <div id="cite" className="scroll-mt-24">
              <CitationCard dataset={dataset} path={`/repository/${id}`} />
            </div>

            {/* Download — links from the backend, bytes from Anvil S3; streamed in */}
            <div id="download" className="scroll-mt-24">
              <Suspense fallback={<DownloadSkeleton />}>
                <SnapshotDownloadSection
                  dataset={dataset}
                  modelInputName={modelInput?.about.name ?? `Model input ${modelInputId.slice(0, 12)}…`}
                />
              </Suspense>
            </div>
          </div>

          {/* Right column */}
          <aside className="flex min-w-0 flex-col gap-4">
            <InfoSection
              title="Snapshot info"
              rows={[
                { label: "License", value: about.license, href: dataset.licenseUrl },
                {
                  label: "Generated At",
                  value: new Date(dataset.generatedAt).toLocaleDateString("en-US", {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  }),
                },
                {
                  label: "Model Input",
                  value: modelInput?.about.name ?? `${modelInputId.slice(0, 12)}…`,
                  internalHref: modelInput ? `/repository/model-inputs/${modelInputId}` : undefined,
                  clamp: 3,
                },
                {
                  label: "Suggested for a new run",
                  value: `${simulation.recommendedCompute.cores} cores · ${simulation.recommendedCompute.walltime}`,
                  mono: true,
                },
                { label: "Model Input Init", value: simulation.init, mono: true },
              ]}
            />

            {/* Code, Container & Execution — uses/runtime, not shown by the legacy UI at all */}
            <ExecutionCard uses={uses} runtime={runtime} />

            {about.keywords.length > 0 && <KeywordsSection keywords={about.keywords} />}

            {about.creator.length > 0 && <CreatorsSection creators={about.creator} />}
          </aside>
        </div>
      </PageBody>

      <Footer />
    </>
  );
}
