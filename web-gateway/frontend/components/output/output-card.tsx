"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { FileDown, Loader2, MapPin, Table2, X } from "lucide-react";
import { DetailSection } from "@/components/repository/detail-section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RESOLUTION_LABELS, type OutputInventory, type OutputResolution, type OutputBounds } from "@/lib/repository/output";
import {
  climatologyKinds,
  filterSeries,
  formatPoint,
  mapQuery,
  offeredResolutions,
  outputBase,
  parseView,
  resolveView,
  seriesCsv,
  seriesFilename,
  seriesQuery,
  styleProblem,
  writeView,
  type OutputSourceRef,
  type Series,
  type ViewState,
} from "@/lib/output/view";
import { DatePicker } from "./date-picker";
import { DownloadNetcdf } from "./download-netcdf";
import { OutputMap } from "./output-map-dynamic";
import { SeriesChart, saveBlob, saveSvgAsPng } from "./series-chart";
import { LegendBar, SELECT_CLASS, StyleControls, type Legend } from "./style-controls";
import { useOutputJson } from "./use-output-json";

interface MapAnswer {
  bbox: OutputBounds;
  units: string | null;
  time: string;
  legend: Legend;
  base64: string;
}

/**
 * The Output card: one variable at one time step as a map, a click for that
 * cell's time series, the selection as NetCDF. It offers only what the
 * inventory lists, and keeps the whole view in the page's URL (`?ovar=...`)
 * so a link reopens it. Used on a snapshot's page (`kind: "dataset"`) and on
 * a finished run's (`kind: "job"`); the two differ only in the routes asked.
 */
export function OutputCard({ source }: { source: OutputSourceRef }) {
  const base = outputBase(source);
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const [view, setView] = useState<ViewState>(() => parseView(new URLSearchParams(searchParams.toString())));
  const [retry, setRetry] = useState(0);

  const inventoryLoad = useOutputJson<OutputInventory>(base, retry);
  const inventory = inventoryLoad.data;
  const resolved = useMemo(() => (inventory ? resolveView(view, inventory) : null), [inventory, view]);

  // What is on screen, with the defaults made explicit, so that the URL says it all.
  const effective: ViewState = useMemo(
    () => (resolved ? { ...view, variable: resolved.variable.name, resolution: resolved.resolution, date: resolved.date } : view),
    [view, resolved]
  );

  useEffect(() => {
    if (!resolved) return;
    // `replaceState`, which Next's router follows, rather than `router.replace`: no history entry per
    // change and no server round trip for a page that already has what it shows.
    const next = writeView(effective, new URLSearchParams(window.location.search));
    const text = next.toString();
    window.history.replaceState(window.history.state, "", `${pathname}${text ? `?${text}` : ""}${window.location.hash}`);
  }, [effective, resolved, pathname]);

  const update = useCallback(
    (patch: Partial<ViewState>) => setView({ ...effective, ...patch }),
    [effective]
  );

  // ─── The map ───
  // Only what the person typed is checked here; a clash with the MT's own range (a min above its max) is the API's 422, shown on the map.
  const problem = resolved ? styleProblem(effective, null) : null;
  const mapUrl =
    resolved && !problem
      ? `${base}/map?${mapQuery({ variable: resolved.variable.name, resolution: resolved.resolution, date: resolved.date }, effective)}`
      : null;
  const map = useOutputJson<MapAnswer>(mapUrl);
  const legend = map.data?.legend ?? null;
  const image = useMemo(
    () => (map.data ? { url: `data:image/png;base64,${map.data.base64}`, bbox: map.data.bbox } : null),
    [map.data]
  );

  // ─── The series ───
  const seriesUrl =
    resolved && effective.point
      ? `${base}/series?${seriesQuery({ variable: resolved.variable.name, resolution: resolved.resolution, date: resolved.date }, effective.point)}`
      : null;
  const series = useOutputJson<Series>(seriesUrl);
  const shown = useMemo(() => {
    if (!series.data || series.dataUrl !== seriesUrl) return null;
    const keep = filterSeries(
      series.data.times.map((_, i) => i),
      effective.offset,
      effective.step
    );
    return { times: keep.map((i) => series.data!.times[i]), values: keep.map((i) => series.data!.values[i]) };
  }, [series.data, series.dataUrl, seriesUrl, effective.offset, effective.step]);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // ─── The card ───
  if (!inventory) {
    return (
      <DetailSection title="Output">
        {inventoryLoad.problem ? (
          <Problem problem={inventoryLoad.problem} onRetry={() => setRetry((n) => n + 1)} />
        ) : (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Reading what the output holds…
          </p>
        )}
      </DetailSection>
    );
  }
  if (!resolved) {
    return (
      <DetailSection title="Output">
        <p className="text-sm text-muted-foreground">This output holds no variable the card can show.</p>
      </DetailSection>
    );
  }

  const { variable, resolution, steps, date } = resolved;
  const offered = offeredResolutions(variable);
  const climatology = climatologyKinds(variable);
  const units = map.data?.units ?? variable.units;
  const unknownVariable = view.variable !== null && view.variable !== variable.name;
  const title = variable.longName ? `${variable.longName} (${variable.name})` : variable.name;

  const saveCsv = () => {
    if (!shown || !effective.point) return;
    const text = seriesCsv(shown.times, shown.values, variable.name, series.data?.units ?? units);
    saveBlob(new Blob([text], { type: "text/csv;charset=utf-8" }), seriesFilename(variable.name, resolution, effective.point, "csv"));
  };
  const savePng = async () => {
    if (!svgRef.current || !effective.point) return;
    setSaveError(null);
    try {
      await saveSvgAsPng(svgRef.current, seriesFilename(variable.name, resolution, effective.point, "png"));
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "The chart could not be saved.");
    }
  };

  return (
    <DetailSection
      title="Output"
      aside={<span className="font-mono text-xs text-muted-foreground">{variable.name} · {RESOLUTION_LABELS[resolution]}</span>}
    >
      {unknownVariable && (
        <p role="status" className="rounded-lg bg-secondary px-3 py-2 text-sm text-secondary-foreground">
          This output has no variable called {view.variable}; showing {variable.name}.
        </p>
      )}

      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          Variable
          <select
            className={`${SELECT_CLASS} max-w-[16rem]`}
            value={variable.name}
            onChange={(event) => update({ variable: event.target.value })}
          >
            {inventory.variables
              .filter((v) => offeredResolutions(v).length > 0)
              .map((v) => (
                <option key={v.name} value={v.name}>
                  {v.longName ? `${v.name} — ${v.longName}` : v.name}
                </option>
              ))}
          </select>
        </label>
        <div className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          Resolution
          <Tabs value={resolution} onValueChange={(r) => update({ resolution: r as OutputResolution })}>
            <TabsList aria-label="Resolution" className="h-9">
              {offered.map((r) => (
                <TabsTrigger key={r} value={r} className="px-3 text-[13px]">
                  {RESOLUTION_LABELS[r]}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
        <div className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          Date
          <DatePicker resolution={resolution} steps={steps} date={date} onChange={(d) => update({ date: d })} />
        </div>
      </div>
      {climatology.length > 0 && (
        <p className="text-xs text-muted-foreground">
          This variable also has {climatology.join(", ")} climatology files. They are in the output files; the map
          and charts show the time steps above.
        </p>
      )}

      <StyleControls
        ramps={inventory.ramps ?? []}
        legend={legend}
        style={effective}
        problem={problem}
        onChange={(patch) => update(patch)}
        onReset={() => update({ ramp: null, min: null, max: null, log: null })}
      />

      <div className="relative" aria-busy={map.loading}>
        <OutputMap
          grid={inventory.grid.bounds}
          image={image}
          point={effective.point}
          onPick={(p) => update({ point: p })}
        />
        {map.loading && (
          <div
            role="status"
            className="absolute top-3 right-3 z-[1000] flex items-center gap-2 rounded-lg bg-card/95 px-3 py-1.5 text-xs shadow-sm"
          >
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            Drawing the map…
          </div>
        )}
        {map.problem && (
          <p
            role="alert"
            className="absolute inset-x-3 bottom-3 z-[1000] rounded-lg bg-card/95 px-3 py-2 text-sm text-destructive shadow-sm"
          >
            {map.problem.message}
          </p>
        )}
      </div>
      {legend && <LegendBar legend={legend} units={units} />}
      {map.data && (
        <p className="text-xs text-muted-foreground">
          {title} · {map.data.time}
          {units ? ` · ${units}` : ""} · Click the map for the time series of a cell.
        </p>
      )}

      <section aria-label="Time series" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-[15px] font-semibold">
            <MapPin className="size-4 text-primary" aria-hidden="true" />
            {effective.point
              ? `Cell at ${formatPoint(effective.point)}${series.data ? ` (cell centre ${formatPoint({ lon: series.data.point.cellLon, lat: series.data.point.cellLat })})` : ""}`
              : "Time series"}
          </h3>
          {effective.point && (
            <Button type="button" variant="ghost" size="sm" onClick={() => update({ point: null })}>
              <X aria-hidden="true" />
              Clear
            </Button>
          )}
        </div>
        {!effective.point && <p className="text-sm text-muted-foreground">Click a cell on the map to see its values over time.</p>}
        {effective.point && (
          <>
            {series.loading && (
              <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Reading the series
                {resolution === "daily" ? ` for ${date.slice(0, 4)}` : ""}…
              </p>
            )}
            {series.problem && (
              <p role="alert" className="rounded-lg bg-secondary px-3 py-2 text-sm text-secondary-foreground">
                {series.problem.message}
                {series.problem.kind === "limit" && resolution === "daily"
                  ? " Daily series are read for the calendar year of the chosen date."
                  : ""}
              </p>
            )}
            {shown && !series.problem && (
              <>
                <div className="flex flex-wrap items-end gap-3">
                  <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
                    Offset
                    <Input
                      key={`offset-${effective.offset}`}
                      type="number"
                      min={0}
                      step={1}
                      defaultValue={effective.offset}
                      className="h-9 w-20 font-mono"
                      aria-label="Offset: the first point kept, counted from 0"
                      onBlur={(event) => {
                        const n = Math.floor(Number(event.currentTarget.value));
                        update({ offset: Number.isFinite(n) && n >= 0 ? n : 0 });
                      }}
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
                    Step
                    <Input
                      key={`step-${effective.step}`}
                      type="number"
                      min={1}
                      step={1}
                      defaultValue={effective.step}
                      className="h-9 w-20 font-mono"
                      aria-label="Step: keep every nth point"
                      onBlur={(event) => {
                        const n = Math.floor(Number(event.currentTarget.value));
                        update({ step: Number.isFinite(n) && n >= 1 ? n : 1 });
                      }}
                    />
                  </label>
                  <p className="pb-2 text-xs text-muted-foreground">
                    Keeps the offset-th point and every step-th after it (monthly: offset 11, step 12 is every December).
                    {" "}
                    {shown.times.length.toLocaleString("en-US")} of {series.data?.times.length.toLocaleString("en-US")} points.
                  </p>
                  <div className="ml-auto flex gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={savePng} className="h-9">
                      <FileDown aria-hidden="true" />
                      Save PNG
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={saveCsv} className="h-9">
                      <Table2 aria-hidden="true" />
                      Save CSV
                    </Button>
                  </div>
                </div>
                <SeriesChart
                  times={shown.times}
                  values={shown.values}
                  units={series.data?.units ?? units}
                  title={title}
                  svgRef={svgRef}
                />
                {saveError && (
                  <p role="alert" className="text-xs text-destructive">
                    {saveError}
                  </p>
                )}
              </>
            )}
          </>
        )}
      </section>

      <DownloadNetcdf key={`${variable.name}-${resolution}`} source={source} inventory={inventory} resolved={resolved} />
    </DetailSection>
  );
}

function Problem({
  problem,
  onRetry,
}: {
  problem: { kind: string; message: string };
  onRetry: () => void;
}) {
  const quiet = problem.kind === "purged" || problem.kind === "missing";
  return (
    <div className="flex flex-col items-start gap-2" role={quiet ? "status" : "alert"}>
      <p className={quiet ? "text-sm text-muted-foreground" : "text-sm text-destructive"}>{problem.message}</p>
      {!quiet && problem.kind !== "signed-out" && (
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}
