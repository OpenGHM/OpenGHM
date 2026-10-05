"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { HardDrive, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, InlineError } from "@/components/admin/admin-page";
import { ConfirmActionDialog } from "@/components/admin/confirm-action-dialog";
import { TimeStamp } from "@/components/common/time-stamp";
import { clearSpoolCache, fetchAnvilScratch } from "@/lib/admin/actions";
import type {
  AnvilScratchQuota,
  AnvilScratchResponse,
  SpoolClearResponse,
  SpoolVariant,
} from "@/lib/admin/types";
import type { ActionFailure } from "@/lib/jobs/types";
import { formatBytesSI, formatCount } from "@/lib/workspace/format";

type Load =
  | { kind: "loading" }
  | { kind: "ready"; data: AnvilScratchResponse }
  | { kind: "error"; failure: ActionFailure };

/** What a failed Anvil call says, from the backend's `detail.code` (503
 *  `anvil_not_configured` / `anvil_unreachable`, 502 `spool_status_failed` /
 *  `spool_clear_failed`) or its status (403). */
function failureCopy(
  failure: ActionFailure,
  action: "load" | "clear"
): { title: string; body: string } {
  if (failure.reason === "session_expired") {
    return { title: "Your session has expired.", body: "Sign in again to continue." };
  }
  if (failure.reason === "not_found") {
    return { title: "Not found.", body: "The backend has no such route." };
  }
  if (failure.status === 403) {
    return { title: "Admins only.", body: "Your account can't view or change Anvil scratch." };
  }
  switch (failure.code) {
    case "anvil_not_configured":
      return {
        title: "Anvil isn't configured for this gateway.",
        body: "The backend has no Anvil connection settings, so there is nothing to show.",
      };
    case "anvil_unreachable":
      return {
        title: "Couldn't reach Anvil.",
        body: "The backend could not open a connection to Anvil. Try again in a minute.",
      };
    case "spool_status_failed":
      return { title: "Anvil couldn't report on the spool cache.", body: failure.message };
    case "spool_clear_failed":
      return {
        title: "Anvil couldn't clear the spool cache.",
        body: `${failure.message} Refresh to see what is left.`,
      };
    default:
      return {
        title: action === "load" ? "Couldn't load Anvil scratch." : "Couldn't clear the spool cache.",
        body: failure.message,
      };
  }
}

function formatPercent(fraction: number): string {
  const pct = fraction * 100;
  return `${pct < 10 ? pct.toFixed(1) : pct.toFixed(0)}%`;
}

function plural(n: number, one: string, many: string): string {
  return `${formatCount(n)} ${n === 1 ? one : many}`;
}

/** One quota as a bar. `marks` are fractions of the limit drawn as ticks with a
 *  label under the bar. At or above `alertAt` the bar turns `destructive`. */
function Meter({
  label,
  used,
  limit,
  valueText,
  marks = [],
  alertAt,
}: {
  label: string;
  used: number;
  limit: number;
  valueText: string;
  marks?: { at: number; label: string }[];
  alertAt?: number;
}) {
  const fraction = limit > 0 ? used / limit : 0;
  const width = Math.min(100, fraction * 100);
  const alert = alertAt !== undefined && fraction >= alertAt;
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
        <span className="font-medium text-foreground">{label}</span>
        <span className="tabular-nums text-muted-foreground">
          {valueText} · <span className="font-semibold text-foreground">{formatPercent(fraction)}</span>
        </span>
      </div>
      <div className="relative mt-2">
        <div
          role="progressbar"
          aria-label={`${label} used`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(width)}
          aria-valuetext={`${valueText}, ${formatPercent(fraction)}`}
          className="h-2.5 w-full overflow-hidden rounded-full bg-muted"
        >
          <div
            className={`h-full rounded-full motion-safe:transition-[width] ${alert ? "bg-destructive" : "bg-primary"}`}
            style={{ width: `${width}%` }}
          />
        </div>
        {marks.map((m) => (
          <span
            key={m.label}
            aria-hidden="true"
            className="absolute -top-0.5 h-3.5 w-px bg-foreground/60"
            style={{ left: `${m.at * 100}%` }}
          />
        ))}
      </div>
      {marks.length > 0 && (
        <div className="relative mt-1 h-4 text-[11px] text-muted-foreground">
          {marks.map((m) => (
            <span
              key={m.label}
              className="absolute -translate-x-1/2 whitespace-nowrap"
              style={{ left: `${m.at * 100}%` }}
            >
              {m.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function QuotaSection({ data }: { data: AnvilScratchResponse }) {
  const quota: AnvilScratchQuota | null = data.quota;
  if (!quota) {
    return (
      <p className="rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2 text-sm text-destructive">
        {data.quota_error ?? "Anvil didn't report the scratch quota."}
      </p>
    );
  }
  return (
    <div className="space-y-4">
      <Meter
        label="Files"
        used={quota.files_used}
        limit={quota.files_limit}
        valueText={`${formatCount(quota.files_used)} of ${formatCount(quota.files_limit)}`}
        alertAt={data.high}
        marks={[
          { at: data.low, label: `${Math.round(data.low * 100)}% target` },
          { at: data.high, label: `${Math.round(data.high * 100)}% prune` },
        ]}
      />
      <Meter
        label="Size"
        used={quota.bytes_used}
        limit={quota.bytes_limit}
        valueText={`${formatBytesSI(quota.bytes_used)} of ${formatBytesSI(quota.bytes_limit)}`}
      />
      <p className="text-xs text-muted-foreground">
        The spool cache is pruned automatically at {Math.round(data.high * 100)}% of the file quota, down to{" "}
        {Math.round(data.low * 100)}%. Files, not size, are the binding limit.
      </p>
    </div>
  );
}

function VariantRow({ v }: { v: SpoolVariant }) {
  return (
    <TableRow>
      <TableCell className="font-mono text-xs" title={v.model_input_id}>
        {v.model_input_id.slice(0, 8)}
      </TableCell>
      <TableCell>{v.network}</TableCell>
      <TableCell>{v.variant}</TableCell>
      <TableCell className="text-right tabular-nums">{formatCount(v.units)}</TableCell>
      <TableCell className="text-right tabular-nums">{formatCount(v.files)}</TableCell>
      <TableCell className="text-right tabular-nums">{formatBytesSI(v.bytes)}</TableCell>
      <TableCell className="text-muted-foreground">
        {v.last_used ? <TimeStamp value={v.last_used} format="relative" /> : "—"}
      </TableCell>
      <TableCell className="tabular-nums">
        {formatCount(v.on_s3_units)} of {formatCount(v.units)}
      </TableCell>
      <TableCell>
        {v.leased_units > 0 ? (
          <span className="rounded-full border border-warning/25 bg-warning/10 px-2.5 py-0.5 text-xs font-semibold tabular-nums text-warning">
            {formatCount(v.leased_units)} in use
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
    </TableRow>
  );
}

function CacheSection({ data }: { data: AnvilScratchResponse }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        {[
          ["Files", formatCount(data.totals.files)],
          ["Size", formatBytesSI(data.totals.bytes)],
          ["Units", formatCount(data.totals.units)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg bg-muted px-3 py-2">
            <p className="text-base font-semibold tabular-nums text-foreground sm:text-lg">{value}</p>
            <p className="text-xs text-muted-foreground">{label}</p>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        In <span className="font-mono [overflow-wrap:anywhere]">{data.cache_root}</span>. A unit is one year of one
        variant.
      </p>
      {data.variants.length === 0 ? (
        <EmptyState title="The spool cache is empty.">
          Nothing is held on scratch. A simulation that needs forcing data fills it again.
        </EmptyState>
      ) : (
        <div className="rounded-lg border">
          <Table className="min-w-[48rem]">
            <TableHeader>
              <TableRow>
                <TableHead>Model input</TableHead>
                <TableHead>Network</TableHead>
                <TableHead>Variant</TableHead>
                <TableHead className="text-right">Years held</TableHead>
                <TableHead className="text-right">Files</TableHead>
                <TableHead className="text-right">Size</TableHead>
                <TableHead>Last used</TableHead>
                <TableHead>S3 copies</TableHead>
                <TableHead>In use</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.variants.map((v) => (
                <VariantRow key={v.dir} v={v} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function LeaseSection({ data }: { data: AnvilScratchResponse }) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-foreground">Active leases: {formatCount(data.leases.length)}</h3>
      {data.leases.length === 0 ? (
        <p className="text-xs text-muted-foreground">No running job is holding years of the cache.</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {data.leases.map((l) => (
            <li
              key={`${l.sim_id}:${l.variant_dir}`}
              title={`Holds ${plural(l.units.length, "year", "years")} of ${l.variant_dir}, until ${l.expires}`}
              className="rounded-md bg-muted px-2 py-0.5 font-mono text-xs text-foreground [overflow-wrap:anywhere]"
            >
              {l.sim_id}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The scratch quota and the spool cache on Anvil, read live from the backend,
 * with the one action on them: clear the cache. The status loads in the browser
 * after the page, because it opens an SSH session to Anvil and the rest of the
 * System page should not wait for that.
 *
 * Clearing asks first: a dry run says what would go, the dialog states it, and
 * only Confirm sends the real request.
 */
export function AnvilScratchCard() {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const [checking, setChecking] = useState(false);
  const [preview, setPreview] = useState<SpoolClearResponse | null>(null);
  const [open, setOpen] = useState(false);
  const [lastClear, setLastClear] = useState<SpoolClearResponse | null>(null);
  const [actionError, setActionError] = useState<{ title: string; body: string } | null>(null);
  const mounted = useRef(true);

  const apply = useCallback((result: Awaited<ReturnType<typeof fetchAnvilScratch>>) => {
    if (!mounted.current) return;
    setLoad(result.ok ? { kind: "ready", data: result.data } : { kind: "error", failure: result });
  }, []);

  useEffect(() => {
    mounted.current = true;
    void fetchAnvilScratch().then(apply);
    return () => {
      mounted.current = false;
    };
  }, [apply]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    const result = await fetchAnvilScratch();
    apply(result);
    if (mounted.current) setRefreshing(false);
  }, [apply]);

  const startClear = async () => {
    setChecking(true);
    setActionError(null);
    const result = await clearSpoolCache(true);
    setChecking(false);
    if (!result.ok) {
      const copy = failureCopy(result, "clear");
      setActionError(copy);
      toast.error(copy.title);
      return;
    }
    if (result.data.deleted_units === 0) {
      toast.info(
        result.data.skipped_leased > 0
          ? `Nothing to clear: the ${plural(result.data.skipped_leased, "year", "years")} left are in use by running jobs.`
          : "The spool cache is already empty."
      );
      return;
    }
    setPreview(result.data);
    setOpen(true);
  };

  const data = load.kind === "ready" ? load.data : null;
  const busy = refreshing || checking || open;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-compute/10 text-compute">
              <HardDrive className="size-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <CardTitle>Anvil scratch</CardTitle>
              <CardDescription className="mt-1 text-xs">
                {data ? (
                  <>
                    Checked <TimeStamp value={data.checked_at} format="relative" />
                  </>
                ) : load.kind === "loading" ? (
                  "Checking Anvil…"
                ) : (
                  "Not checked"
                )}
              </CardDescription>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void refresh()}
              disabled={busy || load.kind === "loading"}
            >
              <RefreshCw className={refreshing ? "motion-safe:animate-spin" : undefined} aria-hidden="true" />
              Refresh
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => void startClear()}
              disabled={busy || load.kind !== "ready"}
            >
              {checking ? (
                <Loader2 className="motion-safe:animate-spin" aria-hidden="true" />
              ) : (
                <Trash2 aria-hidden="true" />
              )}
              {checking ? "Checking…" : "Clear spool cache"}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {actionError && <InlineError title={actionError.title}>{actionError.body}</InlineError>}

        {lastClear && (
          <p role="status" className="rounded-md bg-muted px-3 py-2 text-sm text-foreground">
            Cleared {plural(lastClear.deleted_units, "year", "years")} ({plural(lastClear.deleted_files, "file", "files")},{" "}
            {formatBytesSI(lastClear.deleted_bytes)}).
            {lastClear.skipped_leased > 0 &&
              ` ${plural(lastClear.skipped_leased, "year", "years")} in use by running jobs were kept.`}
          </p>
        )}

        {load.kind === "loading" && (
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden="true" />
            Reading the quota and the cache from Anvil…
          </p>
        )}

        {load.kind === "error" && (
          <InlineError title={failureCopy(load.failure, "load").title}>
            {failureCopy(load.failure, "load").body}
          </InlineError>
        )}

        {data && (
          <>
            <section aria-labelledby="scratch-quota" className="space-y-3">
              <h3 id="scratch-quota" className="text-sm font-medium text-foreground">
                Scratch quota
              </h3>
              <QuotaSection data={data} />
            </section>
            <section aria-labelledby="scratch-cache" className="space-y-3">
              <h3 id="scratch-cache" className="text-sm font-medium text-foreground">
                Spool cache
              </h3>
              <CacheSection data={data} />
            </section>
            <LeaseSection data={data} />
          </>
        )}
      </CardContent>

      {preview && (
        <ConfirmActionDialog
          open={open}
          onOpenChange={setOpen}
          title="Clear the spool cache?"
          description={
            `This deletes ${plural(preview.deleted_units, "year", "years")} of cached data ` +
            `(${plural(preview.deleted_files, "file", "files")}, ${formatBytesSI(preview.deleted_bytes)}) from the spool cache on Anvil scratch. ` +
            (preview.skipped_leased > 0
              ? `${plural(preview.skipped_leased, "year", "years")} in use by running jobs ${preview.skipped_leased === 1 ? "is" : "are"} kept. `
              : "No year is in use by a running job. ") +
            "Cleared days are downloaded from S3 again, or rebuilt by the next simulation that needs them. " +
            "Nothing outside the spool cache is touched: simulation output and model inputs stay."
          }
          confirmLabel="Clear spool cache"
          pendingLabel="Clearing…"
          successMessage="Spool cache cleared."
          failureMessage="Couldn't clear the spool cache. Try again."
          onConfirm={async () => {
            const result = await clearSpoolCache(false);
            if (!result.ok) {
              const copy = failureCopy(result, "clear");
              return { ok: false, message: `${copy.title} ${copy.body}` };
            }
            setLastClear(result.data);
            return { ok: true };
          }}
          onDone={() => {
            void refresh();
          }}
        />
      )}
    </Card>
  );
}
