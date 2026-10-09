import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { fetchDatasetById, fetchDatasetLinks, fetchModelInputById } from "@/lib/repository/actions";
import { PageBody } from "@/components/layout/page-hero";
import { Footer } from "@/components/landing/footer";
import { Button } from "@/components/ui/button";
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
import { DownloadCard } from "@/components/repository/download-card";
import { ExecutionCard } from "@/components/repository/execution-card";
import { OutputVariablesTable } from "@/components/repository/output-variables-table";
import { newStepHref } from "@/lib/workspace/draft-wizard";

export default async function DatasetDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [dataset, links] = await Promise.all([fetchDatasetById(id), fetchDatasetLinks(id)]);
  if (!dataset) notFound();

  const { about, simulation, uses, runtime } = dataset;
  // The snapshot links its model input by id. Show the catalogue's name and
  // link to its page when the catalogue holds it; a lookup failure only
  // costs the name, never the page.
  const modelInputId = uses.modelInput.id;
  const modelInput = await fetchModelInputById(modelInputId).catch(() => null);
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
                Back to Repository
              </Link>
            </Button>
            <Button
              size="xl"
              asChild
              className="h-auto flex-col items-start justify-center gap-px py-2 shadow-float"
            >
              <Link href={newStepHref(dataset.id, "run")}>
                <span className="text-[11.5px] font-normal text-white/80">
                  New snapshot from this model snapshot
                </span>
                Run this snapshot →
              </Link>
            </Button>
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
                    {simulation.outputVariables.length} variable
                    {simulation.outputVariables.length !== 1 ? "s" : ""}
                  </span>
                }
              >
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
              <CitationCard dataset={dataset} />
            </div>

            {/* Download — links from the backend, bytes from Anvil S3 */}
            {links && (
              <div id="download" className="scroll-mt-24">
                <DownloadCard
                  command={links.fetchCommand}
                  browseHref={`/repository/${id}/files`}
                  items={[
                    { label: "Model snapshot tree", url: links.treeUrl, isFile: false },
                    { label: "metadata.json", url: links.metadataUrl, isFile: true },
                    { label: "SHA256SUMS", url: links.sha256sumsUrl, isFile: true },
                    { label: "Container image", url: links.containerUrl, isFile: true },
                    { label: "Model input tree", url: links.modelInputTreeUrl, isFile: false },
                  ]}
                />
              </div>
            )}
          </div>

          {/* Right column */}
          <aside className="flex min-w-0 flex-col gap-4">
            <InfoSection
              title="Dataset Info"
              rows={[
                {
                  label: "WBM Code",
                  value: uses.modelCode.version,
                  title: `Tree hash ${uses.modelCode.treeHash}`,
                  mono: true,
                },
                { label: "License", value: about.license, href: dataset.licenseUrl },
                { label: "Spatial Resolution", value: resolutionLabel, mono: true },
                { label: "Temporal Coverage", value: temporalLabel, mono: true },
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
                  label: "Recommended Compute",
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
