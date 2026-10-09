import { Dataset } from "@/lib/repository/types";

/**
 * The schema.org/Dataset JSON-LD projection `metadata-format.md#notes`
 * describes — generated at render time, never stored (ADR: the gateway
 * stores the spec's shape, not a projection of it). Only the outputs
 * project: `variableMeasured` means what the dataset reports, and a forcing
 * series is an input to the run rather than something it measured.
 */
function buildJsonLd(dataset: Dataset) {
  const { about, simulation } = dataset;
  const box = `${simulation.spatialCoverage.southlimit} ${simulation.spatialCoverage.westlimit} ${simulation.spatialCoverage.northlimit} ${simulation.spatialCoverage.eastlimit}`;

  return {
    "@context": "https://schema.org",
    "@type": "Dataset",
    // The snapshot's own minted id (open item 12's first undecided field,
    // now decided: yes). `distribution` (its second field) stays undecided —
    // a DataDownload needs a real S3 URL convention for the whole snapshot
    // tree, not just this one document, and that isn't settled yet.
    identifier: dataset.id,
    name: about.name,
    description: about.description,
    datePublished: about.datePublished,
    license: dataset.licenseUrl,
    keywords: about.keywords,
    url: about.url,
    creator: about.creator.map((c) => ({
      "@type": "Person",
      name: c.name,
      ...(c.email ? { email: c.email } : {}),
    })),
    ...(about.relatedLink && about.relatedLink.length > 0
      ? {
          citation: about.relatedLink.map((l) => ({
            "@type": "CreativeWork",
            name: l.roleName ?? l.relation,
            url: l.url,
            ...(l.doi
              ? { identifier: { "@type": "PropertyValue", propertyID: "DOI", value: l.doi } }
              : {}),
          })),
        }
      : {}),
    spatialCoverage: {
      "@type": "Place",
      geo: { "@type": "GeoShape", box },
    },
    temporalCoverage: `${simulation.temporalCoverage.start}/${simulation.temporalCoverage.end}`,
    variableMeasured: simulation.outputVariables.map((v) => ({
      "@type": "PropertyValue",
      name: v.name,
      unitText: v.unit,
    })),
  };
}

export function DatasetJsonLd({ dataset }: { dataset: Dataset }) {
  const jsonLd = buildJsonLd(dataset);
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  );
}
