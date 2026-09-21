import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Header } from "@/components/landing/header";
import { Footer } from "@/components/landing/footer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ReviewSubmitClient } from "@/components/workspace/review-submit-client";
import { fetchDatasetById } from "@/lib/repository/actions";
import {
  ChevronRight,
  ArrowLeft,
  Calendar,
  Globe,
  Layers,
  Cpu,
  Tag,
} from "lucide-react";

export default async function ReviewSimulationPage({
  searchParams,
}: {
  searchParams: Promise<{ snapshot_id?: string }>;
}) {
  const session = await auth();
  if (!session) redirect("/auth/signin");

  const params = await searchParams;
  const snapshotId = params.snapshot_id;

  if (!snapshotId) redirect("/workspace/new");

  const snapshot = await fetchDatasetById(snapshotId).catch(() => null);

  if (!snapshot) redirect("/workspace/new");

  const { start, end } = snapshot.simulation.temporalCoverage;
  const coverageDisplay = `${start} → ${end}`;
  const { value: resolutionValue, unit: resolutionUnit } = snapshot.simulation.resolution;

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1">
        {/* Hero */}
        <div className="bg-gradient-to-br from-[#0a192f] to-[#006994] px-10 py-12">
          <div className="mx-auto max-w-[1024px]">
            {/* Breadcrumb */}
            <nav className="mb-4 flex items-center gap-1.5 text-xs text-white/60">
              <Link href="/workspace" className="hover:text-white/90 transition-colors">
                My Simulations
              </Link>
              <ChevronRight className="size-3" />
              <Link href="/workspace/new" className="hover:text-white/90 transition-colors">
                New Simulation
              </Link>
              <ChevronRight className="size-3" />
              <span className="text-white/90">Review</span>
            </nav>

            <div>
              <p className="mb-1 text-sm font-medium text-white/60 uppercase tracking-wider">
                Step 2 of 2
              </p>
              <h1 className="text-3xl font-bold text-white">Review &amp; Submit</h1>
              <p className="mt-2 text-sm text-white/70">
                Confirm the simulation details before submitting to Anvil HPC
              </p>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="bg-slate-50 px-10 py-8">
          <div className="mx-auto max-w-[1024px]">
            <div className="mb-6">
              <Link
                href="/workspace/new"
                className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <ArrowLeft className="size-3.5" />
                Back to snapshot selection
              </Link>
            </div>

            <div className="grid gap-6 lg:grid-cols-3">
              {/* Left column: snapshot details */}
              <div className="space-y-4 lg:col-span-2">
                {/* Snapshot summary */}
                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-3">
                      <CardTitle className="text-base">{snapshot.about.name}</CardTitle>
                      <span className="shrink-0 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
                        {snapshot.about.category}
                      </span>
                    </div>
                    <p className="mt-1 font-mono text-xs text-muted-foreground">
                      {snapshot.uses.container.image}:{snapshot.uses.container.version}
                    </p>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <p className="text-muted-foreground leading-relaxed">
                      {snapshot.about.description}
                    </p>

                    <div className="grid gap-3 pt-2 sm:grid-cols-2">
                      <div className="flex items-start gap-2">
                        <Calendar className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                        <div>
                          <p className="text-xs font-medium text-muted-foreground">
                            Temporal Coverage
                          </p>
                          <p className="font-medium">{coverageDisplay}</p>
                        </div>
                      </div>
                      <div className="flex items-start gap-2">
                        <Globe className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                        <div>
                          <p className="text-xs font-medium text-muted-foreground">
                            Spatial Resolution
                          </p>
                          <p className="font-medium">{resolutionValue} {resolutionUnit}</p>
                        </div>
                      </div>
                      <div className="flex items-start gap-2">
                        <Tag className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                        <div>
                          <p className="text-xs font-medium text-muted-foreground">
                            License
                          </p>
                          <p className="font-medium">{snapshot.about.license}</p>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Output variables */}
                {snapshot.simulation.outputVariables.length > 0 && (
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="flex items-center gap-2 text-base">
                        <Layers className="size-4 text-emerald-600" />
                        Output Variables
                        <span className="ml-auto rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                          All selected
                        </span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="overflow-hidden rounded-md border text-sm">
                        <table className="w-full">
                          <thead>
                            <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                              <th className="px-3 py-2 text-left font-medium">Variable</th>
                              <th className="px-3 py-2 text-left font-medium">Unit</th>
                              <th className="px-3 py-2 text-left font-medium hidden sm:table-cell">
                                Full Name
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y">
                            {snapshot.simulation.outputVariables.map((v, i) => (
                              <tr key={i} className="hover:bg-muted/20">
                                <td className="px-3 py-2 font-medium">{v.name}</td>
                                <td className="px-3 py-2 text-muted-foreground font-mono text-xs">
                                  {v.unit}
                                </td>
                                <td className="px-3 py-2 text-muted-foreground text-xs hidden sm:table-cell">
                                  {v.fullName}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>

              {/* Right column: HPC config & submit */}
              <div className="space-y-4">
                {/* Default HPC config */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Cpu className="size-4 text-blue-600" />
                      HPC Configuration
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <div className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-2">
                      <span className="text-muted-foreground">Cluster</span>
                      <span className="font-medium">Anvil (Purdue)</span>
                    </div>
                    <div className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-2">
                      <span className="text-muted-foreground">Partition</span>
                      <span className="font-medium">shared</span>
                    </div>
                    <div className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-2">
                      <span className="text-muted-foreground">Walltime</span>
                      <span className="font-medium">2h 00m</span>
                    </div>
                    <div className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-2">
                      <span className="text-muted-foreground">Nodes / Tasks</span>
                      <span className="font-medium">1 / 1</span>
                    </div>
                    <p className="pt-1 text-xs text-muted-foreground">
                      Parameter configuration will be available in a future update.
                    </p>
                  </CardContent>
                </Card>

                {/* Submit */}
                <Card className="border-[#006994]/20 bg-[#006994]/5">
                  <CardContent className="pt-5">
                    <ReviewSubmitClient snapshot={snapshot} />
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
