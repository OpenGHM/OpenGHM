import { DetailSection } from "@/components/repository/detail-section";
import { DownloadUnavailable } from "@/components/repository/download-unavailable";
import { SnapshotDownload } from "@/components/repository/download-card";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchDatasetLinks } from "@/lib/repository/actions";
import type { Dataset } from "@/lib/repository/types";

/**
 * A snapshot's Download section, fetched apart from the rest of the page:
 * its links route lists the output from the bucket, which can take seconds
 * the first time, so the page streams it in under a `Suspense`. A route
 * that fails leaves the page standing and the section says it is unavailable.
 */
export async function SnapshotDownloadSection({
  dataset,
  modelInputName,
}: {
  dataset: Dataset;
  modelInputName: string;
}) {
  // A 404 is "no links" (the section is left out); a failure is "unavailable", said where the section would be.
  const links = await fetchDatasetLinks(dataset.id).catch(() => undefined);
  if (links === undefined) return <DownloadUnavailable />;
  if (links === null) return null;
  const { container } = dataset.uses;
  return (
    <SnapshotDownload
      id={dataset.id}
      treeUrl={links.treeUrl}
      output={links.output}
      variables={dataset.simulation.outputVariables.map((v) => ({ name: v.name, fullName: v.fullName }))}
      fetchCommand={links.fetchCommand}
      containerUrl={links.containerUrl}
      containerName={`${container.image}:${container.version}`}
      containerSize={links.containerSize}
      modelInputHref={`/repository/model-inputs/${links.modelInputId}`}
      modelInputName={modelInputName}
    />
  );
}

/** What the section shows while its links load. */
export function DownloadSkeleton() {
  return (
    <DetailSection title="Download">
      <div aria-hidden="true" className="flex flex-col gap-3 rounded-[18px] bg-hero p-6">
        <Skeleton tone="hero" className="h-3 w-20" />
        <Skeleton tone="hero" className="h-6 w-56" />
        <Skeleton tone="hero" className="h-12 w-full rounded-xl" />
        <Skeleton tone="hero" className="h-12 w-full rounded-xl" />
      </div>
      <Skeleton className="h-48 w-full rounded-[18px]" />
    </DetailSection>
  );
}
