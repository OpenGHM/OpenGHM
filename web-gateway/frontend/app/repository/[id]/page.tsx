import { notFound } from "next/navigation";
import Link from "next/link";
import { fetchDatasetById, fetchDatasetLinks, fetchModelInputById } from "@/lib/repository/actions";
import { Header } from "@/components/landing/header";
import { Footer } from "@/components/landing/footer";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DeriveSimulationButton } from "@/components/workspace/derive-simulation-button";
import {
  ArrowLeft,
  Calendar,
  Grid3X3,
  ExternalLink,
  Tag,
  Users,
  Scale,
  Globe,
  Container,
  Timer,
  Mail,
  Info,
  Zap,
  Layers,
  BookOpen,
  Shield,
  Cpu,
  Server,
} from "lucide-react";
import { CitationCard } from "@/components/repository/citation-card";
import { BoundingBoxMap } from "@/components/repository/bounding-box-map-dynamic";
import { OutputVariablesTable } from "@/components/repository/output-variables-table";
import { DatasetJsonLd } from "@/components/repository/dataset-json-ld";
import { DownloadCard } from "@/components/repository/download-card";
import { TagChips } from "@/components/repository/tag-chips";

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
    <div className="flex min-h-screen flex-col">
      <Header />
      <DatasetJsonLd dataset={dataset} />

      {/* Breadcrumb */}
      <div className="bg-muted/50 border-b">
        <div className="mx-auto max-w-[1280px] px-10 py-3 text-sm text-muted-foreground">
          <Link href="/repository" className="hover:text-foreground transition-colors">
            Data Repository
          </Link>
          <span className="mx-2">/</span>
          <span className="text-foreground">{about.name}</span>
        </div>
      </div>

      {/* Hero Banner */}
      <div className="bg-gradient-to-r from-[#0a192f] to-[#006994] py-12">
        <div className="mx-auto max-w-[1280px] px-10">
          <div className="mb-3 flex items-center gap-3">
            <TagChips tags={about.tags} tone="hero" />
            <span className="rounded-full bg-white/15 px-3 py-0.5 text-xs font-semibold text-white">
              Model Snapshot
            </span>
          </div>
          <h1 className="mb-6 text-2xl font-bold leading-tight text-white md:text-3xl">
            {about.name}
          </h1>
          <div className="flex flex-wrap gap-4">
            {[
              { icon: <Calendar className="size-4" />, text: temporalLabel },
              { icon: <Grid3X3 className="size-4" />, text: resolutionLabel },
            ].map((item) => (
              <span
                key={item.text}
                className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-sm text-white backdrop-blur-sm"
              >
                {item.icon}
                {item.text}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className="flex-1 bg-slate-50">
        <div className="mx-auto max-w-[1280px] px-10 py-10">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/repository">
                <ArrowLeft className="mr-1.5 size-4" />
                Back to Repository
              </Link>
            </Button>
            <div className="flex flex-wrap items-center gap-3">
              <DeriveSimulationButton datasetId={dataset.id} />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_340px]">
            {/* Left Column */}
            <div className="space-y-8">
              {/* Description */}
              <Card className="overflow-hidden rounded-xl border-0 gap-0 py-0 shadow-sm">
                <CardHeader className="border-b bg-gradient-to-r from-[#006994]/5 to-transparent !py-4 !gap-0 grid-rows-1 items-center">
                  <CardTitle className="flex items-center gap-2 text-lg font-semibold text-foreground">
                    <div className="flex size-8 items-center justify-center rounded-lg bg-[#006994]/10">
                      <BookOpen className="size-4 text-[#006994]" />
                    </div>
                    Description
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-5 pb-6">
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {about.description}
                  </p>
                </CardContent>
              </Card>

              {/* Spatial Coverage */}
              <Card className="overflow-hidden rounded-xl border-0 gap-0 py-0 shadow-sm">
                <CardHeader className="border-b bg-gradient-to-r from-sky-500/5 to-transparent !py-4 !gap-0 grid-rows-1 items-center">
                  <CardTitle className="flex items-center gap-2 text-lg font-semibold text-foreground">
                    <div className="flex size-8 items-center justify-center rounded-lg bg-sky-500/10">
                      <Globe className="size-4 text-sky-600" />
                    </div>
                    Spatial Coverage
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-5 pb-6 space-y-4">
                  <BoundingBoxMap
                    north={simulation.spatialCoverage.northlimit}
                    south={simulation.spatialCoverage.southlimit}
                    east={simulation.spatialCoverage.eastlimit}
                    west={simulation.spatialCoverage.westlimit}
                  />
                  <div className="flex flex-wrap gap-x-5 gap-y-1.5 rounded-lg bg-slate-50 px-3 py-2.5 text-xs text-muted-foreground">
                    <span><span className="font-medium text-foreground">N</span> {simulation.spatialCoverage.northlimit}°</span>
                    <span><span className="font-medium text-foreground">S</span> {simulation.spatialCoverage.southlimit}°</span>
                    <span><span className="font-medium text-foreground">E</span> {simulation.spatialCoverage.eastlimit}°</span>
                    <span><span className="font-medium text-foreground">W</span> {simulation.spatialCoverage.westlimit}°</span>
                    <span className="text-slate-400">·</span>
                    <span>{simulation.spatialCoverage.projection}</span>
                  </div>
                </CardContent>
              </Card>

              {/* Output Variables */}
              {simulation.outputVariables.length > 0 && (
                <Card className="overflow-hidden rounded-xl border-0 gap-0 py-0 shadow-sm">
                  <CardHeader className="border-b bg-gradient-to-r from-emerald-500/5 to-transparent !py-4 !gap-0 grid-rows-1 items-center">
                    <CardTitle className="flex items-center gap-2 text-lg font-semibold text-foreground">
                      <div className="flex size-8 items-center justify-center rounded-lg bg-emerald-500/10">
                        <Layers className="size-4 text-emerald-600" />
                      </div>
                      Output Variables
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-5 pb-6">
                    <OutputVariablesTable variables={simulation.outputVariables} />
                  </CardContent>
                </Card>
              )}

              {/* Active Processes */}
              {simulation.activeProcesses.length > 0 && (
                <Card className="overflow-hidden rounded-xl border-0 gap-0 py-0 shadow-sm">
                  <CardHeader className="border-b bg-gradient-to-r from-amber-500/5 to-transparent !py-4 !gap-0 grid-rows-1 items-center">
                    <CardTitle className="flex items-center gap-2 text-lg font-semibold text-foreground">
                      <div className="flex size-8 items-center justify-center rounded-lg bg-amber-500/10">
                        <Zap className="size-4 text-amber-600" />
                      </div>
                      Active Processes
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-5 pb-6">
                    <div className="flex flex-wrap gap-2">
                      {simulation.activeProcesses.map((process) => (
                        <span
                          key={process}
                          className="rounded-full bg-amber-100 px-3 py-1 text-sm font-medium text-amber-800"
                        >
                          {process}
                        </span>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Related Links */}
              {about.relatedLink && about.relatedLink.length > 0 && (
                <Card className="overflow-hidden rounded-xl border-0 gap-0 py-0 shadow-sm">
                  <CardHeader className="border-b bg-gradient-to-r from-violet-500/5 to-transparent !py-4 !gap-0 grid-rows-1 items-center">
                    <CardTitle className="flex items-center gap-2 text-lg font-semibold text-foreground">
                      <div className="flex size-8 items-center justify-center rounded-lg bg-violet-500/10">
                        <ExternalLink className="size-4 text-violet-600" />
                      </div>
                      Related Links
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-5 pb-6">
                    <ul className="space-y-3">
                      {about.relatedLink.map((link) => (
                        <li
                          key={link.url}
                          className="rounded-lg border border-violet-100 bg-violet-50/50 p-4"
                        >
                          <div className="flex items-start gap-2">
                            <ExternalLink className="mt-0.5 size-4 shrink-0 text-violet-500" />
                            <div>
                              <a
                                href={link.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-sm font-semibold text-violet-700 transition-colors hover:text-violet-900"
                              >
                                {link.roleName ?? link.relation}
                              </a>
                              {link.description && (
                                <p className="mt-1 text-sm text-muted-foreground">
                                  {link.description}
                                </p>
                              )}
                              {link.doi && (
                                <p className="mt-1 text-xs text-muted-foreground">
                                  DOI: {link.doi}
                                </p>
                              )}
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
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

              {/* Container & Execution — uses/runtime, not shown by the legacy UI at all */}
              <Card className="overflow-hidden rounded-xl border-0 gap-0 py-0 shadow-sm">
                <CardHeader className="border-b bg-gradient-to-r from-slate-500/5 to-transparent !py-4 !gap-0 grid-rows-1 items-center">
                  <CardTitle className="flex items-center gap-2 text-lg font-semibold text-foreground">
                    <div className="flex size-8 items-center justify-center rounded-lg bg-slate-500/10">
                      <Shield className="size-4 text-slate-600" />
                    </div>
                    Container &amp; Execution
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-5 pb-6">
                  <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
                    {[
                      { label: "Container Image", value: `${uses.container.image}:${uses.container.version}` },
                      { label: "Digest", value: uses.container.digest },
                      { label: "Cluster", value: runtime.execution.cluster },
                      { label: "Cores", value: String(runtime.execution.cores) },
                      { label: "Elapsed Walltime", value: runtime.execution.elapsedWalltime },
                      { label: "SLURM Job ID", value: runtime.execution.slurmJobId },
                    ].map((item) => (
                      <div key={item.label} className="rounded-lg bg-slate-50 p-3">
                        <dt className="text-xs font-medium uppercase tracking-wider text-slate-400">
                          {item.label}
                        </dt>
                        <dd className="mt-1 break-all font-mono text-xs font-medium text-foreground">{item.value}</dd>
                      </div>
                    ))}
                  </dl>
                </CardContent>
              </Card>
            </div>

            {/* Right Column (Sidebar) */}
            <div className="space-y-6">
              {/* Dataset Info */}
              <Card className="overflow-hidden rounded-xl border-0 gap-0 py-0 shadow-sm">
                <CardHeader className="bg-gradient-to-r from-[#0a192f] to-[#006994] !py-4 !gap-0 grid-rows-1 items-center">
                  <CardTitle className="flex items-center gap-2 text-lg font-semibold text-white">
                    <Info className="size-5" />
                    Dataset Info
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-5 pb-6">
                  <dl className="space-y-3">
                    <InfoRow
                      icon={<Tag className="size-4" />}
                      label="Software Version"
                      value={uses.container.version}
                      iconColor="text-[#006994]"
                    />
                    <InfoRow
                      icon={<Scale className="size-4" />}
                      label="License"
                      value={about.license}
                      href={dataset.licenseUrl}
                      iconColor="text-emerald-500"
                    />
                    <InfoRow
                      icon={<Grid3X3 className="size-4" />}
                      label="Spatial Resolution"
                      value={resolutionLabel}
                      iconColor="text-sky-500"
                    />
                    <InfoRow
                      icon={<Calendar className="size-4" />}
                      label="Temporal Coverage"
                      value={temporalLabel}
                      iconColor="text-indigo-500"
                    />
                    <InfoRow
                      icon={<Timer className="size-4" />}
                      label="Generated At"
                      value={new Date(dataset.generatedAt).toLocaleDateString("en-US", {
                        year: "numeric", month: "long", day: "numeric",
                      })}
                      iconColor="text-rose-500"
                    />
                    <InfoRow
                      icon={<Container className="size-4" />}
                      label="Model Input"
                      value={modelInput?.about.name ?? `${modelInputId.slice(0, 12)}…`}
                      internalHref={modelInput ? `/repository/model-inputs/${modelInputId}` : undefined}
                      iconColor="text-teal-500"
                    />
                    <InfoRow
                      icon={<Cpu className="size-4" />}
                      label="Recommended Compute"
                      value={`${simulation.recommendedCompute.cores} cores · ${simulation.recommendedCompute.walltime}`}
                      iconColor="text-purple-500"
                    />
                    <InfoRow
                      icon={<Server className="size-4" />}
                      label="Model Input Init"
                      value={simulation.init}
                      iconColor="text-orange-500"
                    />
                  </dl>
                </CardContent>
              </Card>

              {/* Keywords */}
              {about.keywords.length > 0 && (
                <Card className="overflow-hidden rounded-xl border-0 gap-0 py-0 shadow-sm">
                  <CardHeader className="border-b bg-gradient-to-r from-[#00b4d8]/10 to-transparent !py-4 !gap-0 grid-rows-1 items-center">
                    <CardTitle className="flex items-center gap-2 text-lg font-semibold text-foreground">
                      <Tag className="size-5 text-[#00b4d8]" />
                      Keywords
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-4 pb-6">
                    <div className="flex flex-wrap gap-2">
                      {about.keywords.map((kw, i) => {
                        const colors = [
                          "bg-sky-100 text-sky-700 border-sky-200",
                          "bg-emerald-100 text-emerald-700 border-emerald-200",
                          "bg-violet-100 text-violet-700 border-violet-200",
                          "bg-amber-100 text-amber-700 border-amber-200",
                          "bg-rose-100 text-rose-700 border-rose-200",
                        ];
                        return (
                          <span
                            key={kw}
                            className={`rounded-full border px-3 py-1 text-xs font-medium ${colors[i % colors.length]}`}
                          >
                            {kw}
                          </span>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Creators */}
              {about.creator.length > 0 && (
                <Card className="overflow-hidden rounded-xl border-0 gap-0 py-0 shadow-sm">
                  <CardHeader className="border-b bg-gradient-to-r from-[#006994]/5 to-transparent !py-4 !gap-0 grid-rows-1 items-center">
                    <CardTitle className="flex items-center gap-2 text-lg font-semibold text-foreground">
                      <Users className="size-5 text-[#006994]" />
                      Creators
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-4 pb-6">
                    <ul className="space-y-3">
                      {about.creator.map((creator, i) => (
                        <li
                          key={i}
                          className="flex items-start gap-3 rounded-lg bg-slate-50 p-3 text-sm"
                        >
                          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#006994]/10 text-sm font-bold text-[#006994]">
                            {creator.name.charAt(0)}
                          </div>
                          <div>
                            <p className="font-medium text-foreground">{creator.name}</p>
                            {creator.email && (
                              <a
                                href={`mailto:${creator.email}`}
                                className="inline-flex items-center gap-1 text-xs text-[#006994] transition-colors hover:text-[#00b4d8]"
                              >
                                <Mail className="size-3" />
                                {creator.email}
                              </a>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}

function InfoRow({
  icon,
  label,
  value,
  href,
  internalHref,
  iconColor = "text-muted-foreground",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  href?: string;
  internalHref?: string;
  iconColor?: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className={`mt-0.5 ${iconColor}`}>{icon}</div>
      <div className="min-w-0">
        <dt className="text-xs text-muted-foreground">{label}</dt>
        <dd className="text-sm font-medium text-foreground">
          {href ? (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="break-all text-[#006994] transition-colors hover:text-[#00b4d8]"
            >
              {value}
            </a>
          ) : internalHref ? (
            <Link
              href={internalHref}
              className="break-all text-[#006994] transition-colors hover:text-[#00b4d8]"
            >
              {value}
            </Link>
          ) : (
            value
          )}
        </dd>
      </div>
    </div>
  );
}
