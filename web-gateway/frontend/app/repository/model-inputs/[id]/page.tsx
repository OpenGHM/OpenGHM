import { notFound } from "next/navigation";
import Link from "next/link";
import { fetchModelInputById, fetchModelInputLinks } from "@/lib/repository/actions";
import { Header } from "@/components/landing/header";
import { Footer } from "@/components/landing/footer";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  Calendar,
  Grid3X3,
  ExternalLink,
  Tag,
  Users,
  Scale,
  Globe,
  Mail,
  Info,
  Database,
  Waves,
  BookOpen,
} from "lucide-react";
import { BoundingBoxMap } from "@/components/repository/bounding-box-map-dynamic";
import { ModelInputDatasetsTable } from "@/components/repository/model-input-datasets-table";
import { DownloadCard } from "@/components/repository/download-card";
import { CitationCard } from "@/components/repository/citation-card";
import { TagChips } from "@/components/repository/tag-chips";
import { formatLongDate } from "@/lib/workspace/time";

export default async function ModelInputDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [modelInput, links] = await Promise.all([fetchModelInputById(id), fetchModelInputLinks(id)]);
  if (!modelInput) notFound();

  const { about, coverage, datasets, networks } = modelInput;
  const temporalLabel = coverage.temporalCoverage
    ? `${coverage.temporalCoverage.start} – ${coverage.temporalCoverage.end}`
    : "Climatological (no calendar period)";

  return (
    <div className="flex min-h-screen flex-col">
      <Header />

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
      <div className="bg-gradient-to-r from-[#0a192f] to-[#00695c] py-12">
        <div className="mx-auto max-w-[1280px] px-10">
          <div className="mb-3 flex items-center gap-3">
            <TagChips tags={about.tags} tone="hero" />
            <span className="rounded-full bg-white/15 px-3 py-0.5 text-xs font-semibold text-white">
              Model Input
            </span>
          </div>
          <h1 className="mb-6 text-2xl font-bold leading-tight text-white md:text-3xl">
            {about.name}
          </h1>
          <div className="flex flex-wrap gap-4">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-sm text-white backdrop-blur-sm">
              <Calendar className="size-4" />
              {temporalLabel}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-sm text-white backdrop-blur-sm">
              <Database className="size-4" />
              {datasets.length} dataset{datasets.length !== 1 ? "s" : ""}
            </span>
            {networks && networks.length > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-sm text-white backdrop-blur-sm">
                <Waves className="size-4" />
                {networks.length} network{networks.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className="flex-1 bg-slate-50">
        <div className="mx-auto max-w-[1280px] px-10 py-10">
          <div className="mb-6 flex items-center justify-between">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/repository">
                <ArrowLeft className="mr-1.5 size-4" />
                Back to Repository
              </Link>
            </Button>
          </div>

          <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_340px]">
            {/* Left Column */}
            <div className="space-y-8">
              {/* Description */}
              <Card className="overflow-hidden rounded-xl border-0 gap-0 py-0 shadow-sm">
                <CardHeader className="border-b bg-gradient-to-r from-[#00695c]/5 to-transparent !py-4 !gap-0 grid-rows-1 items-center">
                  <CardTitle className="flex items-center gap-2 text-lg font-semibold text-foreground">
                    <div className="flex size-8 items-center justify-center rounded-lg bg-[#00695c]/10">
                      <BookOpen className="size-4 text-[#00695c]" />
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
                    north={coverage.spatialCoverage.northlimit}
                    south={coverage.spatialCoverage.southlimit}
                    east={coverage.spatialCoverage.eastlimit}
                    west={coverage.spatialCoverage.westlimit}
                  />
                  <div className="flex flex-wrap gap-x-5 gap-y-1.5 rounded-lg bg-slate-50 px-3 py-2.5 text-xs text-muted-foreground">
                    <span><span className="font-medium text-foreground">N</span> {coverage.spatialCoverage.northlimit}°</span>
                    <span><span className="font-medium text-foreground">S</span> {coverage.spatialCoverage.southlimit}°</span>
                    <span><span className="font-medium text-foreground">E</span> {coverage.spatialCoverage.eastlimit}°</span>
                    <span><span className="font-medium text-foreground">W</span> {coverage.spatialCoverage.westlimit}°</span>
                    <span className="text-slate-400">·</span>
                    <span>{coverage.spatialCoverage.projection}</span>
                  </div>
                </CardContent>
              </Card>

              {/* Datasets */}
              <Card className="overflow-hidden rounded-xl border-0 gap-0 py-0 shadow-sm">
                <CardHeader className="border-b bg-gradient-to-r from-teal-500/5 to-transparent !py-4 !gap-0 grid-rows-1 items-center">
                  <CardTitle className="flex items-center gap-2 text-lg font-semibold text-foreground">
                    <div className="flex size-8 items-center justify-center rounded-lg bg-teal-500/10">
                      <Database className="size-4 text-teal-600" />
                    </div>
                    Datasets ({datasets.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-5 pb-6">
                  <ModelInputDatasetsTable datasets={datasets} />
                </CardContent>
              </Card>

              {/* Networks */}
              {networks && networks.length > 0 && (
                <Card className="overflow-hidden rounded-xl border-0 gap-0 py-0 shadow-sm">
                  <CardHeader className="border-b bg-gradient-to-r from-indigo-500/5 to-transparent !py-4 !gap-0 grid-rows-1 items-center">
                    <CardTitle className="flex items-center gap-2 text-lg font-semibold text-foreground">
                      <div className="flex size-8 items-center justify-center rounded-lg bg-indigo-500/10">
                        <Waves className="size-4 text-indigo-600" />
                      </div>
                      Networks ({networks.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-5 pb-6">
                    <ul className="space-y-3">
                      {networks.map((n) => (
                        <li
                          key={n.file}
                          className="rounded-lg border border-indigo-100 bg-indigo-50/50 p-4"
                        >
                          <p className="break-all font-mono text-xs font-medium text-foreground">
                            {n.file}
                          </p>
                          {n.resolution && (
                            <p className="mt-1 text-xs text-muted-foreground">
                              {n.resolution.value} {n.resolution.unit}
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
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

              {/* Download — links from the backend, bytes from Anvil S3 */}
              {links && (
                <div id="download" className="scroll-mt-24">
                  <DownloadCard
                    browseHref={`/repository/model-inputs/${id}/files`}
                    items={[
                      { label: "Model input tree", url: links.treeUrl, isFile: false },
                      { label: "metadata.json", url: links.metadataUrl, isFile: true },
                      { label: "SHA256SUMS", url: links.sha256sumsUrl, isFile: true },
                    ]}
                  />
                </div>
              )}

              {/* Citation — the catalogue card's Cite link lands here */}
              <div id="cite" className="scroll-mt-24">
                <CitationCard dataset={modelInput} />
              </div>
            </div>

            {/* Right Column (Sidebar) */}
            <div className="space-y-6">
              {/* Model Input Info */}
              <Card className="overflow-hidden rounded-xl border-0 gap-0 py-0 shadow-sm">
                <CardHeader className="bg-gradient-to-r from-[#0a192f] to-[#00695c] !py-4 !gap-0 grid-rows-1 items-center">
                  <CardTitle className="flex items-center gap-2 text-lg font-semibold text-white">
                    <Info className="size-5" />
                    Model Input Info
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-5 pb-6">
                  <dl className="space-y-3">
                    <InfoRow
                      icon={<Scale className="size-4" />}
                      label="License"
                      value={about.license}
                      href={modelInput.licenseUrl}
                      iconColor="text-emerald-500"
                    />
                    <InfoRow
                      icon={<Calendar className="size-4" />}
                      label="Published"
                      value={formatLongDate(about.datePublished)}
                      iconColor="text-rose-500"
                    />
                    <InfoRow
                      icon={<Grid3X3 className="size-4" />}
                      label="Temporal Coverage"
                      value={temporalLabel}
                      iconColor="text-indigo-500"
                    />
                    <InfoRow
                      icon={<Tag className="size-4" />}
                      label="Slug"
                      value={modelInput.slug}
                      iconColor="text-[#00695c]"
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
                  <CardHeader className="border-b bg-gradient-to-r from-[#00695c]/5 to-transparent !py-4 !gap-0 grid-rows-1 items-center">
                    <CardTitle className="flex items-center gap-2 text-lg font-semibold text-foreground">
                      <Users className="size-5 text-[#00695c]" />
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
                          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#00695c]/10 text-sm font-bold text-[#00695c]">
                            {creator.name.charAt(0)}
                          </div>
                          <div>
                            <p className="font-medium text-foreground">{creator.name}</p>
                            {creator.email && (
                              <a
                                href={`mailto:${creator.email}`}
                                className="inline-flex items-center gap-1 text-xs text-[#00695c] transition-colors hover:text-[#00b4d8]"
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
  iconColor = "text-muted-foreground",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  href?: string;
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
              className="break-all text-[#00695c] transition-colors hover:text-[#00b4d8]"
            >
              {value}
            </a>
          ) : (
            value
          )}
        </dd>
      </div>
    </div>
  );
}
