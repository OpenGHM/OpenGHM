"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  FORK_KEYS,
  fileName,
  forkValueProblem,
  type DatasetFork,
  type DatasetInit,
  type ForkKey,
} from "@/lib/workspace/dataset-forks";
import { useDatasetInit } from "@/lib/workspace/use-dataset-init";

/** What each value of a copy is, in a line under its box. */
const HINTS: Record<ForkKey, string> = {
  Var_Scale:
    "Replaces the original's Var_Scale. WBM multiplies the file's values by it, so it includes any unit conversion the original has.",
  Var_Offset: "Replaces the original's Var_Offset, added after the scale.",
  Units: "Replaces the original's Units: one line of ASCII text.",
};

const PLACEHOLDER: Record<ForkKey, string> = { Var_Scale: "e.g. 1.1", Var_Offset: "e.g. 0", Units: "e.g. mm/day" };

/** Whether a field's value is a data `.init` the run reads, which a copy can be made of. */
export const isDataInit = (value: string): boolean =>
  /^\/wbm\/data(_init)?\/.+\.init$/.test(value.trim());

/**
 * The "Edit dataset" part of a dataset field that reads a data `.init`: the run gets its own copy of
 * the descriptor with the values set here, and the field reads the copy (ADR 0039). The original in
 * the model input is never changed. Only `Var_Scale`, `Var_Offset` and `Units` can be set; each box
 * has the original's value beside it, and an empty box keeps the original's.
 *
 * `fork` is the draft's copy for this field (null: none). `repair` says the original needs a copy
 * whatever is set (WBM 23.9.0 refuses the file itself): the copy then stays, set to nothing, and
 * Reset does not remove it. `onChange` reports the new copy, or null for none. `error` (the
 * backend's message for the field, shown by the row) only keeps the panel open.
 */
export function DatasetForkPanel({
  datasetId,
  path,
  original,
  fork,
  repair = null,
  error = null,
  onChange,
}: {
  datasetId: string;
  /** The init key path of the field. */
  path: string;
  /** The data init the field reads. */
  original: string;
  fork: DatasetFork | null;
  repair?: string | null;
  error?: string | null;
  onChange: (fork: DatasetFork | null) => void;
}) {
  const id = useId();
  const [opened, setOpened] = useState(false);
  const open = opened || fork !== null || error !== null;
  const state = useDatasetInit(datasetId, original, open);
  const set = fork?.set ?? {};

  const keep = (next: Record<string, string>) =>
    Object.keys(next).length === 0 && !repair ? onChange(null) : onChange({ path, original, set: next });

  if (!open) {
    return (
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-10 sm:min-h-8"
          aria-label={`Edit dataset ${fileName(original)}`}
          onClick={() => setOpened(true)}
        >
          Edit dataset
        </Button>
      </div>
    );
  }

  const originalValue = (key: ForkKey, init: DatasetInit | null): string =>
    init === null ? "…" : init[key] === "" ? "not set" : init[key];

  return (
    <div role="group" aria-label={`Edit dataset ${fileName(original)}`} className="space-y-2.5 rounded-[14px] bg-muted/50 px-3.5 py-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="text-[13px] font-semibold text-foreground">Edit dataset</p>
        <div className="flex items-center gap-1.5">
          {fork !== null && !repair && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-10 sm:min-h-8"
              aria-label={`Reset dataset ${fileName(original)}`}
              onClick={() => onChange(null)}
            >
              Reset
            </Button>
          )}
          {fork === null && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-10 sm:min-h-8"
              onClick={() => setOpened(false)}
            >
              Close
            </Button>
          )}
        </div>
      </div>
      <p className="text-xs leading-normal text-muted-foreground">
        The run uses its own copy of <code className="font-mono break-all">{fileName(original)}</code> with the values you set. The original
        in the model input is not changed, and its dates and files stay as they are.
        {repair && <span> {repair}</span>}
      </p>
      {state.status === "error" && (
        <p role="status" className="text-xs text-muted-foreground">
          {state.message} You can still set the values.
        </p>
      )}
      <div className="space-y-2">
        {FORK_KEYS.map((key) => {
          const value = set[key] ?? "";
          const problem = forkValueProblem(key, value);
          const boxId = `${id}-${key}`;
          return (
            <div key={key} className="space-y-0.5">
              <div className="grid items-center gap-x-3 gap-y-1 sm:grid-cols-[7rem_minmax(0,1fr)_minmax(0,12rem)]">
                <Label htmlFor={boxId} className="font-mono text-[12.5px] font-semibold text-foreground">
                  {key}
                </Label>
                <Input
                  id={boxId}
                  type="text"
                  inputMode={key === "Units" ? "text" : "decimal"}
                  autoComplete="off"
                  placeholder={PLACEHOLDER[key]}
                  value={value}
                  aria-invalid={problem !== null || undefined}
                  aria-describedby={`${boxId}-hint`}
                  className="h-10 min-w-0 font-mono md:text-sm"
                  onChange={(e) => {
                    const next = { ...set };
                    if (e.target.value === "") delete next[key];
                    else next[key] = e.target.value;
                    keep(next);
                  }}
                />
                <span className="min-w-0 text-xs break-words text-muted-foreground">
                  Original: <span className="font-mono text-foreground">{originalValue(key, state.status === "ready" ? state.init : null)}</span>
                </span>
              </div>
              <p id={`${boxId}-hint`} className={problem ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
                {problem ?? HINTS[key]}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
