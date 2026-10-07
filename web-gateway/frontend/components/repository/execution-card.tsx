import { Shield } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import type { Dataset } from "@/lib/repository/types";

/**
 * The code, the container and the run, from `uses` and `runtime`. The
 * container carries the runtime and no code (ADR 0032), so `uses.modelCode`,
 * not `uses.container.version`, says which WBM a snapshot runs. The code's
 * tree hash is shown whole, as selectable text, because it is the identity
 * (the version is only where the bytes are published) and what
 * `openghm code hash` prints for a fetched copy.
 */
export function ExecutionCard({ uses, runtime }: Pick<Dataset, "uses" | "runtime">) {
  const items = [
    { label: "WBM Code", value: `${uses.modelCode.name} ${uses.modelCode.version}` },
    { label: "Code Tree Hash", value: uses.modelCode.treeHash },
    { label: "Container Image", value: `${uses.container.image}:${uses.container.version}` },
    { label: "Digest", value: uses.container.digest },
    { label: "Cluster", value: runtime.execution.cluster },
    { label: "Cores", value: String(runtime.execution.cores) },
    { label: "Elapsed Walltime", value: runtime.execution.elapsedWalltime },
    { label: "SLURM Job ID", value: runtime.execution.slurmJobId },
  ];
  return (
    <Card className="overflow-hidden rounded-xl border-0 gap-0 py-0 shadow-sm">
      <CardHeader className="border-b bg-gradient-to-r from-slate-500/5 to-transparent !py-4 !gap-0 grid-rows-1 items-center">
        <CardTitle className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <div className="flex size-8 items-center justify-center rounded-lg bg-slate-500/10">
            <Shield className="size-4 text-slate-600" />
          </div>
          Code, Container &amp; Execution
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-5 pb-6">
        <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
          {items.map((item) => (
            <div
              key={item.label}
              className={`rounded-lg bg-slate-50 p-3${item.label === "Code Tree Hash" ? " sm:col-span-2" : ""}`}
            >
              <dt className="text-xs font-medium uppercase tracking-wider text-slate-400">{item.label}</dt>
              <dd className="mt-1 break-all font-mono text-xs font-medium text-foreground">{item.value}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
