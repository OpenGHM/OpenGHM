"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, X } from "lucide-react";
import { Tabs as TabsPrimitive } from "radix-ui";
import { SWATCHES } from "@/components/repository/output-variables-table";
import { useFolderListing } from "@/components/repository/tree-browser";
import { CopyButton, S3Command } from "@/components/repository/s3-command";
import { SelectionBar } from "@/components/repository/selection-bar";
import { TreeBrowserTable } from "@/components/repository/tree-browser-table";
import { useTreeSelection } from "@/components/repository/use-tree-selection";
import { folderCrumbs } from "@/lib/repository/tree-browse";
import { WORLD_LAND_PATH } from "@/lib/repository/world-land";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { ComingSoonChip, TOOLKIT_NOT_RELEASED } from "@/components/ui/coming-soon-chip";
import { Skeleton } from "@/components/ui/skeleton";
import {
  OUTPUT_RESOLUTIONS,
  RESOLUTION_LABELS,
  boxLabel,
  boxProblem,
  defaultPeriod,
  SUBSET_LIMIT_BYTES,
  degrees,
  maxSubsetBytes,
  middleBox,
  monthName,
  periodLabel,
  periodSteps,
  pickRange,
  refusalMessage,
  s3SyncCommand,
  stepsPerYear,
  subsetCommand,
  subsetFilename,
  subsetQuery,
  type OutputBounds,
  type OutputInventory,
  type OutputPeriod,
  type OutputResolution,
} from "@/lib/repository/output";
import type { OutputFolder } from "@/lib/repository/types";
import { formatBytes } from "@/lib/workspace/format";
import { cn } from "@/lib/utils";

export type OutputTab = "subset" | "files";

/** A variable as the snapshot's metadata lists it, for the swatch order and a missing long name. */
export interface MetadataVariable {
  name: string;
  fullName: string;
}

/** An inventory per snapshot, kept for the page's life: a published output does not change. */
const inventories = new Map<string, OutputInventory>();

type Load = { state: "loading" } | { state: "ready"; inventory: OutputInventory } | { state: "failed"; message: string };

const FOCUS = "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

/** The time step folders of the output, yearly first. */
export function stepFolders(output: OutputFolder[]): OutputFolder[] {
  return OUTPUT_RESOLUTIONS.flatMap((r) => output.filter((f) => f.name === r));
}

/**
 * The "Simulation output" dialog: two tabs, "Download a subset" (one variable
 * over a period and a box, cut on Anvil by the toolkit and saved as NetCDF)
 * and "Output files" (the whole files, folder by folder, and the folder at
 * once with an S3 tool). The inventory is read the first time the subset tab
 * shows; the toolkit decides whether a request is small enough to read, and
 * its refusal is shown in its own words.
 */
export function OutputDialog({
  snapshotId,
  treeUrl,
  output,
  variables,
  open,
  onOpenChange,
  tab,
  onTabChange,
}: {
  snapshotId: string;
  treeUrl: string;
  output: OutputFolder[];
  variables: MetadataVariable[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tab: OutputTab;
  onTabChange: (tab: OutputTab) => void;
}) {
  const totalBytes = output.reduce((sum, f) => sum + f.bytes, 0);
  // A tab is mounted the first time it shows and then kept, so a switch keeps
  // the choices and the folder of each, and the subset tab reads the
  // inventory only once someone looks at it.
  const [seen, setSeen] = useState<OutputTab[]>([tab]);
  if (!seen.includes(tab)) setSeen([...seen, tab]);
  const shown = (t: OutputTab) => t === tab || seen.includes(t);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        overlayClassName="bg-hero/55 backdrop-blur-[4px]"
        className="flex h-[min(880px,calc(100dvh-32px))] w-[min(1160px,calc(100%-32px))] max-w-none flex-col gap-0 overflow-hidden rounded-[22px] border-0 bg-card p-0 shadow-[0_40px_80px_-30px_rgb(8_30_44/0.6)] sm:max-w-none"
      >
        <TabsPrimitive.Root
          value={tab}
          onValueChange={(v) => onTabChange(v as OutputTab)}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="flex shrink-0 flex-col gap-4 border-b border-border px-5 pt-[22px] sm:px-[26px]">
            <div className="flex items-start justify-between gap-4">
              <div className="flex min-w-0 flex-col gap-1">
                <span className="font-mono text-[11.5px] font-medium tracking-[0.06em] text-primary uppercase">
                  NetCDF{totalBytes > 0 && ` · ${formatBytes(totalBytes)}`}
                </span>
                <DialogTitle className="text-xl font-semibold tracking-[-0.02em]">Simulation output</DialogTitle>
                <DialogDescription className="sr-only">
                  Download a subset of the output, or its whole files.
                </DialogDescription>
              </div>
              <DialogClose
                className={cn(
                  "inline-flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-muted text-foreground transition-colors hover:bg-border",
                  FOCUS
                )}
              >
                <X className="size-[18px]" aria-hidden="true" />
                <span className="sr-only">Close</span>
              </DialogClose>
            </div>
            <TabsPrimitive.List aria-label="Ways to download" className="flex gap-6">
              {(
                [
                  ["subset", "Download a subset"],
                  ["files", "Output files"],
                ] as const
              ).map(([value, label]) => (
                <TabsPrimitive.Trigger
                  key={value}
                  value={value}
                  className={cn(
                    "-mb-px border-b-2 border-transparent pb-3 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground data-[state=active]:border-primary data-[state=active]:text-foreground",
                    FOCUS
                  )}
                >
                  {label}
                </TabsPrimitive.Trigger>
              ))}
            </TabsPrimitive.List>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <TabsPrimitive.Content value="subset" forceMount className="outline-none data-[state=inactive]:hidden">
              {shown("subset") && <SubsetTab snapshotId={snapshotId} variables={variables} />}
            </TabsPrimitive.Content>
            <TabsPrimitive.Content value="files" forceMount className="outline-none data-[state=inactive]:hidden">
              {shown("files") && <FilesTab snapshotId={snapshotId} treeUrl={treeUrl} output={output} />}
            </TabsPrimitive.Content>
          </div>
        </TabsPrimitive.Root>
      </DialogContent>
    </Dialog>
  );
}

// ─── Download a subset ────────────────────────────────────────────────────────

function SubsetTab({ snapshotId, variables }: { snapshotId: string; variables: MetadataVariable[] }) {
  const [load, setLoad] = useState<Load>(() => {
    const kept = inventories.get(snapshotId);
    return kept ? { state: "ready", inventory: kept } : { state: "loading" };
  });
  const started = useRef(inventories.has(snapshotId));

  useEffect(() => {
    // Mounted when the tab first shows: read the inventory once. State is set
    // only when the answer is in.
    if (started.current) return;
    started.current = true;
    let live = true;
    readInventory(snapshotId).then((next) => live && setLoad(next));
    return () => {
      live = false;
      started.current = false;
    };
  }, [snapshotId]);

  const retry = () => {
    setLoad({ state: "loading" });
    readInventory(snapshotId).then(setLoad);
  };

  if (load.state === "loading") {
    return (
      <div aria-label="Reading what the output holds" className="flex flex-wrap">
        <div className="flex min-w-0 flex-[1_1_440px] flex-col gap-4 px-5 pt-[22px] pb-7 sm:px-[26px]">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-10 w-full rounded-[9px]" />
          <Skeleton className="h-40 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
        </div>
        <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-4 border-border bg-background px-6 pt-[22px] pb-[26px] min-[780px]:border-l">
          <Skeleton className="aspect-[2/1] w-full rounded-xl" />
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    );
  }
  if (load.state === "failed") {
    return (
      <div className="flex flex-col items-start gap-3 px-5 py-7 sm:px-[26px]">
        <p role="alert" className="text-sm text-destructive">
          {load.message}
        </p>
        <button
          type="button"
          onClick={retry}
          className={cn("rounded-[9px] border border-border px-3 py-2 text-[13px] font-semibold hover:border-primary hover:text-primary", FOCUS)}
        >
          Try again
        </button>
      </div>
    );
  }
  if (load.inventory.variables.length === 0) {
    return <p className="px-5 py-7 text-sm text-muted-foreground sm:px-[26px]">This snapshot&apos;s output holds no variable to cut.</p>;
  }
  return <SubsetForm snapshotId={snapshotId} inventory={load.inventory} variables={variables} />;
}

async function readInventory(snapshotId: string): Promise<Load> {
  try {
    const response = await fetch(`/api/repository/datasets/${snapshotId}/output`);
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) return { state: "failed", message: refusalMessage(body) ?? "The output could not be read." };
    inventories.set(snapshotId, body as OutputInventory);
    return { state: "ready", inventory: body as OutputInventory };
  } catch {
    return { state: "failed", message: "The gateway could not be reached. Try again in a moment." };
  }
}

type Fetch =
  | { state: "idle" }
  | { state: "preparing" }
  | { state: "downloading"; received: number; total: number | null }
  | { state: "done" }
  | { state: "failed"; message: string };

type BoxFields = Record<keyof OutputBounds, string>;

function firstResolution(available: Partial<Record<OutputResolution, unknown>>): OutputResolution {
  return OUTPUT_RESOLUTIONS.find((r) => r in available) ?? "yearly";
}

function SubsetForm({
  snapshotId,
  inventory,
  variables,
}: {
  snapshotId: string;
  inventory: OutputInventory;
  variables: MetadataVariable[];
}) {
  const id = useId();
  const grid = inventory.grid.bounds;
  const order = useMemo(() => new Map(variables.map((v, i) => [v.name, i])), [variables]);
  const fullNames = useMemo(() => new Map(variables.map((v) => [v.name, v.fullName])), [variables]);
  const options = useMemo(
    () =>
      inventory.variables.map((v, i) => ({
        ...v,
        description: v.longName || fullNames.get(v.name) || "",
        swatch: SWATCHES[(order.get(v.name) ?? i) % SWATCHES.length],
      })),
    [inventory.variables, order, fullNames]
  );

  const [variableName, setVariableName] = useState(options[0].name);
  const variable = options.find((v) => v.name === variableName) ?? options[0];
  const [resolution, setResolution] = useState<OutputResolution>(() => firstResolution(variable.resolutions));
  const years = variable.resolutions[resolution]?.years ?? [];
  const [period, setPeriod] = useState<OutputPeriod>(() => defaultPeriod(years, resolution));
  const [waiting, setWaiting] = useState<"years" | "months" | null>(null);
  const [query, setQuery] = useState("");
  const [region, setRegion] = useState<"grid" | "box">("grid");
  const [fields, setFields] = useState<BoxFields>(() => {
    const b = middleBox(grid);
    return { north: String(b.north), south: String(b.south), west: String(b.west), east: String(b.east) };
  });
  const [fetchState, setFetchState] = useState<Fetch>({ state: "idle" });
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const reset = () => {
    if (fetchState.state === "failed" || fetchState.state === "done") setFetchState({ state: "idle" });
  };
  const chooseResolution = (next: OutputResolution, forVariable = variable) => {
    setResolution(next);
    setPeriod(defaultPeriod(forVariable.resolutions[next]?.years ?? [], next));
    setWaiting(null);
    reset();
  };
  const chooseVariable = (name: string) => {
    const next = options.find((v) => v.name === name);
    setVariableName(name);
    if (next && !(resolution in next.resolutions)) chooseResolution(firstResolution(next.resolutions), next);
    reset();
  };

  const isBox = region === "box";
  const box: OutputBounds = {
    north: Number(fields.north),
    south: Number(fields.south),
    west: Number(fields.west),
    east: Number(fields.east),
  };
  const problem = isBox ? boxProblem(box, grid) : null;
  const ok = !problem;
  const sentBox = isBox && ok ? box : null;

  const area = isBox ? box : grid;
  const cell = inventory.grid.cellSize;
  const estimate = ok ? maxSubsetBytes(periodSteps(resolution, period), area, cell) : null;
  const filename = subsetFilename(variable.name, resolution, period, isBox);
  const command = subsetCommand({ snapshotId, variable: variable.name, resolution, period, box: sentBox, filename });
  const busy = fetchState.state === "preparing" || fetchState.state === "downloading";

  const q = query.trim().toLowerCase();
  const shown = options.filter((v) => !q || `${v.name} ${v.description}`.toLowerCase().includes(q));

  const pickYear = (y: number) => {
    const next = pickRange({ from: period.from, to: period.to }, y, waiting === "years");
    setPeriod((p) => ({ ...p, from: next.from, to: next.to }));
    setWaiting(next.waiting ? "years" : null);
    reset();
  };
  const pickMonth = (m: number) => {
    const next = pickRange({ from: period.monthFrom, to: period.monthTo }, m, waiting === "months");
    setPeriod((p) => ({ ...p, monthFrom: next.from, monthTo: next.to }));
    setWaiting(next.waiting ? "months" : null);
    reset();
  };

  const download = async () => {
    if (!ok || busy) return;
    const controller = new AbortController();
    abort.current = controller;
    setFetchState({ state: "preparing" });
    try {
      const response = await fetch(
        `/api/repository/datasets/${snapshotId}/output/subset?${subsetQuery({ variable: variable.name, resolution, period, box: sentBox })}`,
        { signal: controller.signal }
      );
      if (!response.ok || !response.body) {
        const body: unknown = await response.json().catch(() => null);
        setFetchState({ state: "failed", message: refusalMessage(body) ?? "The file could not be made. Try again." });
        return;
      }
      const total = Number(response.headers.get("content-length")) || null;
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let received = 0;
      setFetchState({ state: "downloading", received, total });
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        setFetchState({ state: "downloading", received, total });
      }
      const url = URL.createObjectURL(new Blob(chunks as BlobPart[], { type: "application/x-netcdf" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setFetchState({ state: "done" });
    } catch (error) {
      if ((error as { name?: string }).name === "AbortError") {
        setFetchState({ state: "idle" });
        return;
      }
      setFetchState({ state: "failed", message: "The download stopped before it finished. Try again." });
    }
  };

  const monthsShown = resolution !== "yearly";
  const hint =
    waiting === "years"
      ? "Now click the last year. Click the same year again for a single year."
      : waiting === "months"
        ? "Now click the last month. Click the same month again for a single month."
        : !monthsShown
          ? "Click a first year, then a last year."
          : period.from === period.to
            ? "Click a first and a last year, then a first and a last month."
            : `From ${monthName(period.monthFrom)} ${period.from} to ${monthName(period.monthTo)} ${period.to}. Click years, then months.`;

  return (
    <div className="flex flex-wrap items-stretch">
      {/* The choices */}
      <div className="flex min-w-0 flex-[1_1_440px] flex-col gap-[26px] px-5 pt-[22px] pb-7 sm:px-[26px]">
        <p className="text-[13.5px] leading-relaxed text-pretty text-muted-foreground">
          One variable over the period and region you choose, as a NetCDF file cut from the output on Anvil.
        </p>

        <div className="flex flex-col gap-2.5">
          <div className="flex items-baseline justify-between gap-2.5">
            <span id={`${id}-variable`} className="text-sm font-semibold">
              Variable
            </span>
            <span className="font-mono text-xs text-muted-foreground">{options.length} in this run</span>
          </div>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or description"
            aria-label="Search variables"
            className="w-full rounded-[9px] border border-input bg-card px-3 py-2.5 text-sm outline-none focus:border-primary"
          />
          <div
            role="radiogroup"
            aria-labelledby={`${id}-variable`}
            className="flex max-h-[214px] flex-col gap-0.5 overflow-y-auto rounded-xl border border-border p-1"
          >
            {shown.map((v) => {
              const selected = v.name === variable.name;
              return (
                <button
                  key={v.name}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={[v.name, v.description, v.units].filter(Boolean).join(", ")}
                  disabled={busy}
                  onClick={() => chooseVariable(v.name)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-[9px] px-2.5 py-[9px] text-left transition-colors",
                    FOCUS,
                    selected ? "bg-secondary" : "hover:bg-muted"
                  )}
                >
                  <span aria-hidden="true" className="size-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: v.swatch }} />
                  <span className="flex min-w-0 flex-1 flex-col gap-px">
                    <span className="font-mono text-[13px] font-medium">{v.name}</span>
                    {v.description && (
                      <span className="truncate text-[12.5px] text-muted-foreground">{v.description}</span>
                    )}
                  </span>
                  {v.units && <span className="shrink-0 font-mono text-xs text-muted-foreground">{v.units}</span>}
                  <span aria-hidden="true" className="flex w-4 shrink-0 justify-center text-primary">
                    {selected && <Check className="size-3.5" strokeWidth={3} />}
                  </span>
                </button>
              );
            })}
            {shown.length === 0 && <div className="p-3.5 text-[13px] text-muted-foreground">No variable matches.</div>}
          </div>
        </div>

        <div className="flex flex-col gap-2.5">
          <span id={`${id}-step`} className="text-sm font-semibold">
            Time step
          </span>
          <div role="radiogroup" aria-labelledby={`${id}-step`} className="grid grid-cols-3 gap-2">
            {OUTPUT_RESOLUTIONS.map((r) => {
              const available = r in variable.resolutions;
              const per = ok ? maxSubsetBytes(stepsPerYear(r), area, cell) : null;
              const selected = r === resolution;
              return (
                <button
                  key={r}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={!available || busy}
                  onClick={() => chooseResolution(r)}
                  className={cn(
                    "flex min-w-0 flex-col gap-[3px] rounded-xl border-[1.5px] px-[13px] py-[11px] text-left transition-colors disabled:cursor-not-allowed disabled:opacity-45",
                    FOCUS,
                    selected ? "border-primary bg-secondary/50" : "border-border bg-card hover:border-primary/50"
                  )}
                >
                  <span className="text-sm font-semibold">{RESOLUTION_LABELS[r]}</span>
                  <span className="font-mono text-[11.5px] leading-snug text-muted-foreground">
                    {!available ? "Not written" : per === null ? "—" : `≤ ${formatBytes(per)} / year`}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <span id={`${id}-period`} className="text-sm font-semibold">
              Period
            </span>
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-[12.5px] text-secondary-foreground">{periodLabel(resolution, period)}</span>
              <button
                type="button"
                disabled={busy || years.length === 0}
                onClick={() => {
                  setPeriod((p) => ({ ...p, from: years[0], to: years[years.length - 1], monthFrom: 1, monthTo: 12 }));
                  setWaiting(null);
                  reset();
                }}
                className={cn("rounded-lg px-[9px] py-[5px] text-[12.5px] font-semibold text-primary hover:bg-secondary", FOCUS)}
              >
                All years
              </button>
            </div>
          </div>
          <div role="group" aria-labelledby={`${id}-period`} className="grid grid-cols-[repeat(auto-fill,minmax(62px,1fr))] gap-1.5">
            {years.map((y) => (
              <RangeChip
                key={y}
                label={String(y)}
                end={y === period.from || y === period.to}
                inside={y > period.from && y < period.to}
                disabled={busy}
                onClick={() => pickYear(y)}
              />
            ))}
          </div>
          {monthsShown && (
            <div role="group" aria-label="Months" className="grid grid-cols-[repeat(auto-fill,minmax(52px,1fr))] gap-1.5">
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
                const single = period.from === period.to;
                return (
                  <RangeChip
                    key={m}
                    label={monthName(m)}
                    end={m === period.monthFrom || m === period.monthTo}
                    inside={single && m > period.monthFrom && m < period.monthTo}
                    disabled={busy}
                    onClick={() => pickMonth(m)}
                  />
                );
              })}
            </div>
          )}
          <span className="text-xs leading-relaxed text-muted-foreground">{hint}</span>
        </div>

        <div className="flex flex-col gap-2.5">
          <span id={`${id}-region`} className="text-sm font-semibold">
            Region
          </span>
          <div role="radiogroup" aria-labelledby={`${id}-region`} className="flex gap-0.5 self-start rounded-[11px] bg-muted p-[3px]">
            {(
              [
                ["grid", "The whole grid"],
                ["box", "A box"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={region === value}
                disabled={busy}
                onClick={() => {
                  setRegion(value);
                  reset();
                }}
                className={cn(
                  "rounded-lg px-3.5 py-[7px] text-[13px] font-semibold transition-colors",
                  FOCUS,
                  region === value ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {isBox && (
            <div className="grid grid-cols-[repeat(auto-fit,minmax(96px,1fr))] gap-2">
              {(["north", "south", "west", "east"] as const).map((edge) => (
                <label key={edge} className="flex min-w-0 flex-col gap-1">
                  <span className="text-xs text-muted-foreground capitalize">{edge}</span>
                  <input
                    type="number"
                    step="0.25"
                    value={fields[edge]}
                    disabled={busy}
                    aria-invalid={problem ? true : undefined}
                    onChange={(e) => {
                      const value = e.target.value;
                      setFields((f) => ({ ...f, [edge]: value }));
                      reset();
                    }}
                    className="w-full rounded-[9px] border border-input bg-card px-2.5 py-[9px] font-mono text-[13px] outline-none focus:border-primary aria-invalid:border-destructive"
                  />
                </label>
              ))}
            </div>
          )}
          <span role={problem ? "alert" : undefined} className={cn("text-xs leading-normal", problem ? "text-destructive" : "text-muted-foreground")}>
            {problem ??
              `Degrees, ${inventory.grid.crs ?? "EPSG:4326"}. The grid covers ${degrees(grid.south, "N", "S")} to ${degrees(grid.north, "N", "S")} and ${degrees(grid.west, "E", "W")} to ${degrees(grid.east, "E", "W")}.`}
          </span>
        </div>
      </div>

      {/* The file */}
      <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-4 border-t border-border bg-background px-6 pt-[22px] pb-[26px] min-[780px]:border-t-0 min-[780px]:border-l">
        <span className="font-mono text-[11.5px] font-medium tracking-[0.06em] text-primary uppercase">Your file</span>
        <GridPreview grid={grid} box={isBox ? (ok ? box : null) : grid} />
        <code className="font-mono text-[13.5px] font-medium break-all">{filename}</code>
        <dl className="flex flex-col">
          <SummaryRow label="Variable">{variable.description || variable.name}</SummaryRow>
          <SummaryRow label="Time step">{RESOLUTION_LABELS[resolution]}</SummaryRow>
          <SummaryRow label="Period">{periodLabel(resolution, period)}</SummaryRow>
          <SummaryRow label="Region">{!isBox ? "The whole grid" : ok ? boxLabel(box) : "—"}</SummaryRow>
          <div className="flex items-baseline justify-between gap-3 border-t border-border pt-3">
            <dt className="flex flex-col text-[12.5px] text-muted-foreground">
              Size, at most
              <span className="text-[11.5px]">before compression; the file is smaller</span>
            </dt>
            <dd className="text-2xl font-semibold tracking-[-0.02em]">{estimate === null ? "—" : formatBytes(estimate)}</dd>
          </div>
        </dl>
        {estimate !== null && estimate > SUBSET_LIMIT_BYTES && fetchState.state !== "failed" && (
          <p className="rounded-[10px] bg-warning/10 px-3 py-2.5 text-[12.5px] leading-normal text-pretty text-warning">
            Over 1 GB before compression, more than one download may hold. Choose a shorter period, a box, or a
            coarser time step.
          </p>
        )}
        {fetchState.state === "failed" && (
          <p role="alert" className="rounded-[10px] bg-destructive/10 px-3 py-2.5 text-[12.5px] leading-normal text-pretty text-destructive">
            {fetchState.message}
          </p>
        )}
        <DownloadButton state={fetchState} ok={ok} onClick={download} onStop={() => abort.current?.abort()} />
        <div className="flex flex-col gap-2 border-t border-border pt-3.5">
          <div className="flex items-center justify-between gap-2">
            <span className="flex flex-wrap items-center gap-2 text-[12.5px] font-semibold">
              Same file from a script
              <ComingSoonChip title={TOOLKIT_NOT_RELEASED} />
            </span>
            <CopyButton text={command} label="subset command" tone="quiet" />
          </div>
          <code className="block rounded-[10px] border border-border bg-card px-3 py-2.5 font-mono text-xs leading-relaxed break-all text-foreground/90">
            <span aria-hidden="true" className="text-primary">
              ${" "}
            </span>
            {command}
          </code>
        </div>
      </div>
    </div>
  );
}

function RangeChip({
  label,
  end,
  inside,
  disabled,
  onClick,
}: {
  label: string;
  end: boolean;
  inside: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={end || inside}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "rounded-[9px] py-[9px] font-mono text-[13px] transition-colors",
        FOCUS,
        end
          ? "bg-primary text-primary-foreground"
          : inside
            ? "bg-secondary text-secondary-foreground"
            : "bg-muted text-foreground/80 hover:bg-border"
      )}
    >
      {label}
    </button>
  );
}

function SummaryRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-3 border-t border-border py-2">
      <dt className="text-[12.5px] text-muted-foreground">{label}</dt>
      <dd className="text-right text-[13px] font-medium">{children}</dd>
    </div>
  );
}

/** Degrees between graticule lines for a span: fewer lines on a larger map. */
function graticuleStep(span: number): number {
  return span > 120 ? 30 : span > 40 ? 10 : 5;
}

/**
 * The grid on a base map with the box on it; the whole grid lit when there
 * is no box. Drawn like a catalogue card's thumbnail: the same land outline
 * on a 360 x 180 plane, one unit per degree (x = longitude + 180, y = 90 -
 * latitude), framed to the grid with a margin. The panel takes its shape, kept
 * between 6:5 and 13:5 so a narrow or a very wide grid still reads.
 */
function GridPreview({ grid, box }: { grid: OutputBounds; box: OutputBounds | null }) {
  // A margin round the grid, so the whole grid lit still shows where it sits.
  const pad = 0.08 * Math.max(grid.east - grid.west, grid.north - grid.south);
  const view = { west: grid.west - pad, east: grid.east + pad, south: grid.south - pad, north: grid.north + pad };
  const width = view.east - view.west;
  const height = view.north - view.south;
  const ratio = Math.min(2.6, Math.max(1.2, width / height));
  const x = (lon: number) => lon + 180;
  const y = (lat: number) => 90 - lat;
  const step = graticuleStep(Math.max(width, height));
  const lons: number[] = [];
  for (let lon = Math.ceil(view.west / step) * step; lon <= view.east; lon += step) lons.push(lon);
  const lats: number[] = [];
  for (let lat = Math.ceil(view.south / step) * step; lat <= view.north; lat += step) lats.push(lat);
  return (
    <div aria-hidden="true" className="relative overflow-hidden rounded-xl bg-accent" style={{ aspectRatio: ratio }}>
      <svg
        viewBox={`${x(view.west)} ${y(view.north)} ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        className="absolute inset-0 size-full"
      >
        <path
          data-testid="grid-preview-land"
          d={WORLD_LAND_PATH}
          className="fill-white stroke-primary/30"
          strokeWidth={0.5}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        <g className="stroke-primary/10" strokeWidth={1}>
          {lons.map((lon) => (
            <line key={`x${lon}`} x1={x(lon)} y1={y(view.north)} x2={x(lon)} y2={y(view.south)} vectorEffect="non-scaling-stroke" />
          ))}
          {lats.map((lat) => (
            <line key={`y${lat}`} x1={x(view.west)} y1={y(lat)} x2={x(view.east)} y2={y(lat)} vectorEffect="non-scaling-stroke" />
          ))}
        </g>
        {box && (
          <rect
            data-testid="grid-preview-box"
            x={x(box.west)}
            y={y(box.north)}
            width={box.east - box.west}
            height={box.north - box.south}
            className="fill-primary/[0.16] stroke-primary"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
    </div>
  );
}

function DownloadButton({
  state,
  ok,
  onClick,
  onStop,
}: {
  state: Fetch;
  ok: boolean;
  onClick: () => void;
  onStop: () => void;
}) {
  const busy = state.state === "preparing" || state.state === "downloading";
  const percent =
    state.state === "downloading" && state.total ? Math.min(100, Math.round((state.received / state.total) * 100)) : null;
  const label = !ok
    ? "Fix the box to download"
    : state.state === "preparing"
      ? "Cutting the file…"
      : state.state === "downloading"
        ? `Downloading${percent !== null ? ` ${percent}%` : ` ${formatBytes(state.received)}`}`
        : state.state === "done"
          ? "Saved ✓"
          : "Download NetCDF";
  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={onClick}
        disabled={!ok || busy}
        aria-live="polite"
        className={cn(
          "relative overflow-hidden rounded-xl px-4 py-[13px] text-[14.5px] font-semibold text-primary-foreground transition-[filter] hover:brightness-[0.92] disabled:cursor-not-allowed",
          FOCUS,
          !ok ? "bg-muted-foreground/50" : state.state === "done" ? "bg-success" : "bg-primary"
        )}
      >
        {percent !== null && (
          <span aria-hidden="true" className="absolute inset-y-0 left-0 bg-white/15" style={{ width: `${percent}%` }} />
        )}
        <span className="relative">{label}</span>
      </button>
      {busy && (
        <button
          type="button"
          onClick={onStop}
          className={cn("self-center rounded-md px-2 py-1 text-xs font-semibold text-muted-foreground hover:text-foreground", FOCUS)}
        >
          Stop
        </button>
      )}
      {state.state === "preparing" && (
        <span className="text-center text-xs text-muted-foreground">Anvil cuts it from the output first. This can take a few minutes.</span>
      )}
    </div>
  );
}

// ─── Output files ─────────────────────────────────────────────────────────────

const FOLDER_TEXT: Record<OutputResolution, string> = {
  yearly: "One file per variable and year",
  monthly: "One file per variable and year",
  daily: "One file per year, every variable in it",
};

function FilesTab({ snapshotId, treeUrl, output }: { snapshotId: string; treeUrl: string; output: OutputFolder[] }) {
  const rows = stepFolders(output);
  const total = output.reduce((sum, f) => sum + f.bytes, 0);
  const files = output.reduce((sum, f) => sum + f.files, 0);
  const runs = [...new Set(output.map((f) => f.run))];
  const outputPath = runs.length === 1 ? `wbm_output/${runs[0]}/` : "wbm_output/";
  const sync = s3SyncCommand(treeUrl, outputPath, "./wbm_output");
  // The folder open in the browser below, or null for the overview.
  const [browsing, setBrowsing] = useState<string | null>(null);
  if (browsing !== null) {
    return (
      <FolderBrowser
        snapshotId={snapshotId}
        root={outputPath}
        folder={browsing}
        onOpen={setBrowsing}
        onBack={() => setBrowsing(null)}
      />
    );
  }
  return (
    <div className="flex flex-col gap-6 px-5 pt-[22px] pb-7 sm:px-[26px]">
      <p className="max-w-[640px] text-[13.5px] leading-relaxed text-pretty text-muted-foreground">
        The output as the run wrote it, whole NetCDF files you download one by one. Start with the yearly files; the
        daily ones are large.
      </p>
      {rows.length > 0 && (
        <ul aria-label="Output by time step" className="overflow-hidden rounded-[14px] border border-border">
          {rows.map((folder) => {
            const r = folder.name as OutputResolution;
            const share = total > 0 ? folder.bytes / total : 0;
            return (
              <li
                key={folder.path}
                className="flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-border/70 px-[18px] py-4 first:border-t-0"
              >
                <div className="flex min-w-0 flex-[1_1_240px] flex-col gap-[3px]">
                  <span className="flex items-center gap-2">
                    <span className="text-[15px] font-semibold">{RESOLUTION_LABELS[r]}</span>
                    {share >= 0.5 && (
                      <span className="rounded-full bg-warning/10 px-2 py-0.5 text-[11px] font-semibold text-warning">Large</span>
                    )}
                  </span>
                  <span className="text-[13px] text-muted-foreground">{FOLDER_TEXT[r]}</span>
                </div>
                <div className="flex min-w-0 flex-[1_1_200px] flex-col gap-1.5">
                  <span className="flex justify-between gap-2 font-mono text-[12.5px]">
                    <span className="font-medium">{formatBytes(folder.bytes)}</span>
                    <span className="text-muted-foreground">{folder.files.toLocaleString("en-US")} files</span>
                  </span>
                  <div aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(1.5, share * 100).toFixed(1)}%` }} />
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setBrowsing(folder.path)}
                  aria-label={`Browse ${RESOLUTION_LABELS[r]} output`}
                  className={cn(
                    "shrink-0 rounded-[9px] border border-border px-[13px] py-2 text-[13px] font-semibold transition-colors hover:border-primary hover:text-primary",
                    FOCUS
                  )}
                >
                  Browse →
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex flex-col gap-3.5 border-t border-border pt-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-[3px]">
            <span className="text-[15px] font-semibold">Everything at once</span>
            <span className="text-[13px] text-muted-foreground">
              {files > 0 ? `All ${files.toLocaleString("en-US")} files, ${formatBytes(total)}.` : "The whole output folder."}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setBrowsing(outputPath)}
            className={cn("rounded-[9px] px-2 py-1 text-[13px] font-semibold text-primary hover:bg-secondary", FOCUS)}
          >
            All output files →
          </button>
        </div>
        <S3Command command={sync} />
      </div>
    </div>
  );
}

/**
 * A folder of the output, browsed inside the dialog: the files page's table
 * and listing, with the folder kept in state rather than the URL, so leaving
 * the page is never the price of a look. Crumbs run from the output's root;
 * a file is downloaded or its URL copied, and the files page (a new tab)
 * previews it. Ticked entries come down as one ZIP.
 */
function FolderBrowser({
  snapshotId,
  root,
  folder,
  onOpen,
  onBack,
}: {
  snapshotId: string;
  /** The output's root, `wbm_output/<run>/`: the first crumb. */
  root: string;
  folder: string;
  onOpen: (path: string) => void;
  onBack: () => void;
}) {
  const listing = useFolderListing("snapshot", snapshotId, folder);
  const selection = useTreeSelection("snapshot", snapshotId, folder);
  const { view } = listing;
  const pagePath = `/repository/${snapshotId}/files`;
  const crumbs = folderCrumbs(folder).filter((c) => c.path.length > root.length);
  return (
    <div className="flex flex-col">
      <div className="sticky top-0 z-10 bg-card">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-5 py-3 sm:px-[26px]">
          <button
            type="button"
            onClick={onBack}
            className={cn("rounded-[9px] px-2 py-1 text-[13px] font-semibold text-primary hover:bg-secondary", FOCUS)}
          >
            ← Output files
          </button>
          <nav aria-label="Output folders" className="min-w-0 flex-1">
            <ol className="flex flex-wrap items-center gap-1 font-mono text-[13px]">
              <BrowserCrumb label="output" current={folder === root} onClick={() => onOpen(root)} />
              {crumbs.map((c) => (
                <BrowserCrumb key={c.path} label={c.name} current={c.path === folder} onClick={() => onOpen(c.path)} separator />
              ))}
            </ol>
          </nav>
          <a
            href={`${pagePath}?path=${encodeURIComponent(folder).replaceAll("%2F", "/")}`}
            target="_blank"
            rel="noopener noreferrer"
            className={cn("rounded-[9px] px-2 py-1 text-[13px] font-semibold text-muted-foreground hover:bg-muted hover:text-foreground", FOCUS)}
          >
            Open in files page ↗
          </a>
        </div>
        <SelectionBar
          kind="snapshot"
          id={snapshotId}
          folder={folder}
          files={view.status === "ready" ? view.listing.files : []}
          selection={selection}
          className="border-b border-border"
        />
      </div>
      {view.status === "loading" && (
        <div role="status" aria-label="Loading folder" className="space-y-3 px-6 py-5">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-4" style={{ width: `${70 - i * 8}%` }} />
          ))}
        </div>
      )}
      {view.status === "error" && (
        <div role="alert" className="flex flex-col items-center gap-3 px-6 py-12 text-center text-sm text-muted-foreground">
          {view.code === "listing_unavailable"
            ? "The file listing is unavailable right now. The storage service did not answer."
            : "This folder is not in the tree."}
          {view.code === "listing_unavailable" && (
            <button
              type="button"
              onClick={listing.retry}
              className={cn("rounded-[9px] border border-border px-3 py-1.5 text-[13px] font-semibold hover:border-primary hover:text-primary", FOCUS)}
            >
              Retry
            </button>
          )}
        </div>
      )}
      {view.status === "ready" && (
        <>
          {view.listing.folders.length === 0 && view.listing.files.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">This folder is empty.</p>
          ) : (
            <TreeBrowserTable
              pathname={pagePath}
              folder={folder}
              folders={view.listing.folders}
              files={view.listing.files}
              onOpenFolder={onOpen}
              selection={selection}
            />
          )}
          {view.listing.nextCursor !== null && (
            <div className="flex flex-col items-center gap-2 border-t border-border py-4">
              {listing.moreFailed && (
                <p role="alert" className="text-xs text-destructive">
                  The next entries could not be loaded.
                </p>
              )}
              <button
                type="button"
                onClick={listing.loadMore}
                disabled={listing.loadingMore}
                className={cn("rounded-[9px] border border-border px-3 py-1.5 text-[13px] font-semibold hover:border-primary hover:text-primary disabled:opacity-60", FOCUS)}
              >
                {listing.loadingMore ? "Loading…" : listing.moreFailed ? "Try again" : "Load more"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function BrowserCrumb({
  label,
  current,
  onClick,
  separator = false,
}: {
  label: string;
  current: boolean;
  onClick: () => void;
  separator?: boolean;
}) {
  return (
    <li className="flex items-center gap-1">
      {separator && <span aria-hidden="true" className="text-muted-foreground">/</span>}
      {current ? (
        <span aria-current="page" className="font-medium text-foreground">
          {label}
        </span>
      ) : (
        <button type="button" onClick={onClick} className={cn("rounded text-primary hover:text-primary-hover hover:underline", FOCUS)}>
          {label}
        </button>
      )}
    </li>
  );
}
