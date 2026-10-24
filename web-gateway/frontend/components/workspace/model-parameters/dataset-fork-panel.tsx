"use client";

import { useId, useState } from "react";
import { FileCog, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  FORK_KEYS,
  factorFromScale,
  fileName,
  forkValueProblem,
  scaleFromFactor,
  type DatasetFork,
  type DatasetInit,
  type ForkKey,
} from "@/lib/workspace/dataset-forks";
import { useDatasetInit } from "@/lib/workspace/use-dataset-init";

/** What each value of a copy is, in a line under its box. */
const HINTS: Record<ForkKey, string> = {
  Var_Scale:
    "The whole factor: WBM computes value × Var_Scale + Var_Offset, so it includes any unit conversion the original has.",
  Var_Offset: "Added after the scale.",
  Units: "One line of ASCII text.",
};

/** What each value is called, for a person, under its key. */
const HUMAN: Record<ForkKey, string> = { Var_Scale: "Scale factor", Var_Offset: "Offset", Units: "Units" };

const PLACEHOLDER: Record<ForkKey, string> = { Var_Scale: "e.g. 1.1", Var_Offset: "e.g. 0", Units: "e.g. mm/day" };

/** Whether a field's value is a data `.init` the run reads, which a copy can be made of. */
export const isDataInit = (value: string): boolean =>
  /^\/wbm\/data(_init)?\/.+\.init$/.test(value.trim());

/**
 * The "Edit dataset" part of a dataset field that reads a data `.init`: the run gets its own copy of
 * the descriptor with the values set here, and the field reads the copy (ADR 0039). The original in
 * the model input is never changed. Only `Var_Scale`, `Var_Offset` and `Units` can be set; each box
 * has the original's value beside it, and an empty box keeps the original's. Under `Var_Scale`, a
 * multiplier does the sum: the original times 1.1 is the `Var_Scale` for 10% more.
 *
 * `fork` is the draft's copy for this field (null: none). `repair` says the original needs a copy
 * whatever is set (WBM 23.9.0 refuses the file itself): the copy then stays, set to nothing, and
 * Reset does not remove it. `onChange` reports the new copy, or null for none. `error` (the
 * backend's message for the field, shown by the row) only keeps the panel open.
 *
 * `closedClassName` and `openClassName` place the panel in the row's grid, closed (the button) and
 * open (the copy's values).
 */
export function DatasetForkPanel({
  datasetId,
  path,
  original,
  fork,
  repair = null,
  error = null,
  closedClassName,
  openClassName,
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
  closedClassName?: string;
  openClassName?: string;
  onChange: (fork: DatasetFork | null) => void;
}) {
  const id = useId();
  const [opened, setOpened] = useState(false);
  // What was typed in the multiplier, and the Var_Scale it left: the text stays as typed (`1.`, `1.10`)
  // while that Var_Scale stands; once Var_Scale changes some other way, the multiplier is read from it.
  const [typed, setTyped] = useState<{ text: string; scale: string } | null>(null);
  const open = opened || fork !== null || error !== null;
  const state = useDatasetInit(datasetId, original, open);
  const set = fork?.set ?? {};

  const keep = (next: Record<string, string>) =>
    Object.keys(next).length === 0 && !repair ? onChange(null) : onChange({ path, original, set: next });

  if (!open) {
    return (
      <div className={cn("sm:flex sm:justify-end", closedClassName)}>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-10 sm:min-h-8"
          aria-label={`Edit dataset ${fileName(original)}`}
          onClick={() => setOpened(true)}
        >
          <SlidersHorizontal aria-hidden="true" />
          Edit dataset
        </Button>
      </div>
    );
  }

  const originalValue = (key: ForkKey, init: DatasetInit | null): string =>
    init === null ? "…" : init[key] === "" ? "not set" : init[key];
  const init = state.status === "ready" ? state.init : null;

  /** Set one value of the copy; an empty one is not set. */
  const write = (key: ForkKey, text: string) => {
    const next = { ...set };
    if (text === "") delete next[key];
    else next[key] = text;
    keep(next);
  };

  // The multiplier is offered when the original's Var_Scale is a number to multiply.
  const originalScale = init?.Var_Scale ?? "";
  const canMultiply = scaleFromFactor(originalScale, "1") !== null;
  const scale = set.Var_Scale ?? "";
  const factor = typed !== null && typed.scale === scale ? typed.text : factorFromScale(originalScale, scale);
  const product = scaleFromFactor(originalScale, factor);
  const factorBad = factor.trim() !== "" && product === null;
  const factorId = `${id}-factor`;

  const multiply = (text: string) => {
    const made = scaleFromFactor(originalScale, text);
    const nextScale = text.trim() === "" ? "" : (made ?? scale);
    setTyped({ text, scale: nextScale });
    if (nextScale !== scale) write("Var_Scale", nextScale);
  };

  return (
    <div
      role="group"
      aria-label={`Edit dataset ${fileName(original)}`}
      className={cn("space-y-3 rounded-xl border border-border/70 bg-muted/30 p-3.5", openClassName)}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="flex min-w-0 items-center gap-2 text-[13px] font-semibold text-foreground">
          <FileCog aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0">
            Your copy of <code className="font-mono break-all">{fileName(original)}</code>
          </span>
        </p>
        <div className="flex items-center gap-1.5">
          {fork !== null && !repair && (
            <Button
              type="button"
              variant="ghost"
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
              variant="ghost"
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
        The run uses its own copy with the values you set. The original in the model input is not changed, and its
        dates and files stay as they are.
        {repair && <span> {repair}</span>}
      </p>
      {state.status === "error" && (
        <p role="status" className="text-xs text-muted-foreground">
          {state.message} You can still set the values.
        </p>
      )}
      <div className="space-y-3.5">
        {FORK_KEYS.map((key) => {
          const value = set[key] ?? "";
          const problem = forkValueProblem(key, value);
          const boxId = `${id}-${key}`;
          return (
            <div key={key} className="grid gap-x-4 gap-y-1.5 sm:grid-cols-[7.5rem_minmax(0,1fr)]">
              <div className="min-w-0">
                <Label htmlFor={boxId} className="font-mono text-[12.5px] font-semibold text-foreground">
                  {key}
                </Label>
                <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{HUMAN[key]}</p>
              </div>
              <div className="min-w-0 space-y-1.5">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                  <Input
                    id={boxId}
                    type="text"
                    inputMode={key === "Units" ? "text" : "decimal"}
                    autoComplete="off"
                    placeholder={PLACEHOLDER[key]}
                    value={value}
                    aria-invalid={problem !== null || undefined}
                    aria-describedby={`${boxId}-hint`}
                    className="h-10 min-w-40 flex-1 rounded-lg font-mono md:text-sm"
                    onChange={(e) => write(key, e.target.value)}
                  />
                  <span className="inline-flex max-w-full shrink-0 items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-[11px] leading-none text-muted-foreground sm:w-36">
                    Original
                    <span className="min-w-0 font-mono font-medium break-all text-foreground">
                      {originalValue(key, init)}
                    </span>
                  </span>
                </div>
                {key === "Var_Scale" && canMultiply && (
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Label htmlFor={factorId} className="text-xs font-normal text-muted-foreground">
                      Multiply the original Var_Scale by
                    </Label>
                    <Input
                      id={factorId}
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      placeholder="e.g. 1.1"
                      value={factor}
                      aria-invalid={factorBad || undefined}
                      className="h-8 w-24 rounded-lg font-mono text-xs md:text-xs"
                      onChange={(e) => multiply(e.target.value)}
                    />
                    {product !== null && <span className="font-mono text-xs text-muted-foreground">= {product}</span>}
                  </div>
                )}
                <p id={`${boxId}-hint`} className={problem ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
                  {problem ?? HINTS[key]}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
