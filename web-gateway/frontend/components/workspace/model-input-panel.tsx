import Link from "next/link";
import { AlertTriangle, CheckCircle2, Database, Info, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DraftCard } from "@/components/workspace/draft-card";
import type { ModelInput } from "@/lib/repository/types";

const shortId = (id: string) => `${id.slice(0, 12)}…`;

/**
 * Which model input a draft runs against, and what the catalogue says about it.
 *
 * `modelInputId` is the draft's own override (set through the API: the wizard
 * cannot choose one, because the toolkit has no option for it and a submit
 * refuses it, ADR 0025); `inheritedId` is the one the snapshot cites, or null
 * when the snapshot could not be loaded. `resolved` is the catalogue's answer
 * for whichever of the two applies (`useCatalogueModelInput`): `undefined`
 * while looking, `null` when it does not hold it.
 *
 * Five cases: chosen (a warning, and Revert when `onRevert` is given),
 * inherited and found, inherited and not in the catalogue (said plainly: the
 * run fetches the snapshot's model input by its id, so it changes nothing),
 * still looking, and unknown (no snapshot to read it from).
 */
export function ModelInputStatus({
  modelInputId,
  inheritedId,
  resolved,
  onRevert,
  disabled = false,
}: {
  modelInputId: string | null;
  inheritedId: string | null;
  resolved: ModelInput | null | undefined;
  /** Shown only for a chosen model input; clears the override. */
  onRevert?: () => void;
  disabled?: boolean;
}) {
  if (modelInputId !== null) {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-warning/30 bg-warning/5 p-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-2">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
          <div className="min-w-0">
            <p className="break-words text-sm font-semibold text-foreground">
              Chosen: {resolved ? resolved.about.name : <code className="font-mono">{shortId(modelInputId)}</code>}
            </p>
            <p className="text-xs text-muted-foreground">
              {resolved === null && "The model-inputs catalogue does not hold it. "}
              This replaces the model snapshot&apos;s own model input, which can&apos;t run yet.
              Revert to inherit to submit.
            </p>
          </div>
        </div>
        {onRevert && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={onRevert}
            className="min-h-10 shrink-0 bg-white sm:min-h-8"
          >
            <RotateCcw className="size-3.5" aria-hidden="true" />
            Revert to inherit
          </Button>
        )}
      </div>
    );
  }

  if (inheritedId === null) {
    return (
      <div className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3">
        <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div>
          <p className="text-sm font-semibold text-foreground">Inherited</p>
          <p className="text-xs text-muted-foreground">
            The run uses the model snapshot&apos;s own model input. Which one that is can&apos;t be
            shown, because the model snapshot could not be loaded.
          </p>
        </div>
      </div>
    );
  }

  if (resolved === undefined) {
    return (
      <div className="flex items-center gap-2 rounded-lg border p-3 text-sm text-muted-foreground">
        <Loader2 className="size-4 shrink-0 motion-safe:animate-spin" aria-hidden="true" />
        Checking the model-inputs catalogue…
      </div>
    );
  }

  if (resolved) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-success/25 bg-success/5 p-3">
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
        <div className="min-w-0">
          <p className="break-words text-sm font-semibold text-foreground">
            Inherited: {resolved.about.name}
          </p>
          <p className="text-xs text-muted-foreground">
            From the model snapshot (
            <Link
              href={`/repository/model-inputs/${encodeURIComponent(inheritedId)}`}
              className="font-mono text-primary hover:underline"
            >
              {shortId(inheritedId)}
            </Link>
            ), found in the catalogue.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3">
      <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div>
        <p className="text-sm font-semibold text-foreground">Inherited</p>
        <p className="text-xs text-muted-foreground">
          From the model snapshot (<code className="font-mono">{shortId(inheritedId)}</code>). The
          catalogue does not list it. The run fetches it by id, so this changes nothing about the run.
        </p>
      </div>
    </div>
  );
}

/** Step 2's "Model input" card: the status above, and what the server said if
 *  it refused a change to it. */
export function ModelInputPanel({
  error,
  ...status
}: React.ComponentProps<typeof ModelInputStatus> & { error?: string }) {
  return (
    <DraftCard title="Model input" icon={Database}>
      <ModelInputStatus {...status} />
      {error && <p className="text-xs text-destructive">{error}</p>}
    </DraftCard>
  );
}
