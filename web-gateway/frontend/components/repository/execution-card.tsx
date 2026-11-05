import { DetailSection } from "@/components/repository/detail-section";
import { WbmCodeChip } from "@/components/repository/wbm-code-chip";
import { codeStateNote } from "@/lib/repository/wbm-code";
import type { CodeState, Dataset } from "@/lib/repository/types";

/**
 * The code, the container and the run, from `uses` and `runtime`. The
 * container carries the runtime and no code (ADR 0032), so `uses.modelCode`,
 * not `uses.container.version`, says which WBM a snapshot runs. The code's
 * tree hash is shown whole, as selectable text, because it is the identity
 * (the version is only where the bytes are published) and what
 * `openghm code hash` prints for a fetched copy. A code that is not `current`
 * carries a chip by its version and the sentence under it (`codeReason`: why a
 * withdrawn version was withdrawn).
 */
export function ExecutionCard({
  uses,
  runtime,
  codeState = "unknown",
  codeReason = null,
}: Pick<Dataset, "uses" | "runtime"> & { codeState?: CodeState; codeReason?: string | null }) {
  // The identity of the code and the container, one under another, then the run in four tiles.
  const identity = [
    { label: "Container Image", value: `${uses.container.image}:${uses.container.version}`, long: false },
    { label: "Digest", value: uses.container.digest, long: true },
    { label: "WBM Code", value: `${uses.modelCode.name} ${uses.modelCode.version}`, long: false },
    { label: "Code Tree Hash", value: uses.modelCode.treeHash, long: true },
  ];
  const run = [
    { label: "Cluster", value: runtime.execution.cluster },
    { label: "Cores", value: String(runtime.execution.cores) },
    { label: "Elapsed Walltime", value: runtime.execution.elapsedWalltime },
    { label: "SLURM Job ID", value: runtime.execution.slurmJobId },
  ];
  return (
    <DetailSection title="Code, Container & Execution" heading="side" tone="navy">
      <dl className="flex flex-col gap-4">
        {identity.map((item) => (
          <div key={item.label} className="flex flex-col gap-[3px]">
            <dt className="text-xs text-hero-eyebrow">{item.label}</dt>
            <dd
              className={
                item.long
                  ? "font-mono text-xs leading-normal break-all text-hero-text"
                  : "font-mono text-sm break-all"
              }
            >
              {item.value}
              {item.label === "WBM Code" && (
                <WbmCodeChip state={codeState} reason={codeReason} tone="dark" spoken={false} className="ml-2 align-middle" />
              )}
            </dd>
          </div>
        ))}
      </dl>
      {codeStateNote(codeState, codeReason) && (
        <p className="text-xs leading-normal text-hero-text">{codeStateNote(codeState, codeReason)}</p>
      )}
      <div className="flex flex-col gap-2">
        <h3 className="text-xs text-hero-eyebrow">How this run was executed</h3>
        <dl className="grid grid-cols-2 gap-2">
          {run.map((item) => (
            <div key={item.label} className="flex min-w-0 flex-col gap-[3px] rounded-xl bg-white/[0.06] p-3">
              <dt className="text-[11.5px] text-hero-eyebrow">{item.label}</dt>
              <dd className="font-mono text-[15px] break-words">{item.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </DetailSection>
  );
}
