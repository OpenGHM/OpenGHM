import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { fetchModelInputLinks } from "@/lib/repository/actions";
import { getModelInput } from "@/lib/repository/detail-data";
import { PageBody } from "@/components/layout/page-hero";
import { Footer } from "@/components/landing/footer";
import { Button } from "@/components/ui/button";
import { CitationCard } from "@/components/repository/citation-card";
import { DetailHero, HeroChip } from "@/components/repository/detail-hero";
import { DetailSection } from "@/components/repository/detail-section";
import {
  CreatorsSection,
  DescriptionSection,
  InfoSection,
  KeywordsSection,
  RelatedLinksSection,
  SpatialCoverageSection,
} from "@/components/repository/detail-parts";
import { ModelInputDownload } from "@/components/repository/download-card";
import { DownloadUnavailable } from "@/components/repository/download-unavailable";
import { ModelInputDatasetsTable } from "@/components/repository/model-input-datasets-table";
import { formatLongDate } from "@/lib/workspace/time";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const modelInput = await getModelInput(id);
  return { title: modelInput ? `${modelInput.about.name} | OpenGHM` : "Model input not found | OpenGHM" };
}

export default async function ModelInputDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // The links are fetched beside the item and may fail without it: `undefined`
  // is "could not be had" (the section says so), `null` is a 404 ("no links").
  const [modelInput, links] = await Promise.all([
    getModelInput(id),
    fetchModelInputLinks(id).catch(() => undefined),
  ]);
  if (!modelInput) notFound();

  const { about, coverage, datasets, networks } = modelInput;
  const temporalLabel = coverage.temporalCoverage
    ? `${coverage.temporalCoverage.start} – ${coverage.temporalCoverage.end}`
    : "Climatological (no calendar period)";

  return (
    <>
      <DetailHero
        kind="model-input"
        name={about.name}
        tags={about.tags}
        breadcrumb={[{ label: about.name }]}
        timeline={coverage.temporalCoverage ?? undefined}
        chips={
          <>
            <HeroChip label="Coverage">{temporalLabel}</HeroChip>
            <HeroChip label="Datasets">{datasets.length}</HeroChip>
            {networks && networks.length > 0 && <HeroChip label="Networks">{networks.length}</HeroChip>}
          </>
        }
        actions={
          <Button variant="on-dark" size="xl" asChild>
            <Link href="/repository">
              <ArrowLeft aria-hidden="true" />
              Back to Data Repository
            </Link>
          </Button>
        }
      />

      <PageBody>
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
          {/* Left column */}
          <div className="flex min-w-0 flex-col gap-4">
            <DescriptionSection description={about.description} />

            <SpatialCoverageSection
              north={coverage.spatialCoverage.northlimit}
              south={coverage.spatialCoverage.southlimit}
              east={coverage.spatialCoverage.eastlimit}
              west={coverage.spatialCoverage.westlimit}
              projection={coverage.spatialCoverage.projection}
            />

            <DetailSection title={`Datasets (${datasets.length})`}>
              <ModelInputDatasetsTable datasets={datasets} />
            </DetailSection>

            {networks && networks.length > 0 && (
              <DetailSection title={`Networks (${networks.length})`}>
                <ul className="flex flex-col gap-3">
                  {networks.map((n) => (
                    <li key={n.file} className="rounded-[14px] border border-border px-[18px] py-3.5">
                      <p className="font-mono text-[13px] font-medium break-all">{n.file}</p>
                      {n.resolution && (
                        <p className="mt-1 text-[13.5px] text-muted-foreground">
                          {n.resolution.value} {n.resolution.unit}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </DetailSection>
            )}

            {about.relatedLink && about.relatedLink.length > 0 && (
              <RelatedLinksSection links={about.relatedLink} />
            )}

            {/* Citation — the catalogue card's Cite link lands here */}
            <div id="cite" className="scroll-mt-24">
              <CitationCard dataset={modelInput} path={`/repository/model-inputs/${id}`} />
            </div>

            {/* Download — links from the backend, bytes from Anvil S3 */}
            {links !== null && (
              <div id="download" className="scroll-mt-24">
                {links ? (
                  <ModelInputDownload id={id} treeUrl={links.treeUrl} fetchCommand={links.fetchCommand} />
                ) : (
                  <DownloadUnavailable />
                )}
              </div>
            )}
          </div>

          {/* Right column */}
          <aside className="flex min-w-0 flex-col gap-4">
            <InfoSection
              title="Model Input Info"
              rows={[
                { label: "License", value: about.license, href: modelInput.licenseUrl },
                { label: "Published", value: formatLongDate(about.datePublished) },
                { label: "Temporal Coverage", value: temporalLabel, mono: true },
                { label: "Slug", value: modelInput.slug, mono: true },
              ]}
            />

            {about.keywords.length > 0 && <KeywordsSection keywords={about.keywords} />}

            {about.creator.length > 0 && <CreatorsSection creators={about.creator} />}
          </aside>
        </div>
      </PageBody>

      <Footer />
    </>
  );
}
