"use client";

import { useEffect, useId, useRef, useState } from "react";
import { AlertTriangle, Search, X } from "lucide-react";
import { draftField } from "@/components/workspace/draft-field";
import { DraftCollapsible } from "@/components/workspace/draft-section";
import {
  FLAT_LIST_LIMIT,
  groupVariables,
  matchesVariable,
  type VariableItem,
} from "@/lib/workspace/variable-groups";

/** A variable the draft can be asked to write, and what to call it. */
export interface VariableOption extends VariableItem {
  /** False for a variable the snapshot does not list (it is in the draft only
   *  because it was stored there). */
  listed: boolean;
}

const CHECKBOX = "size-4 shrink-0 rounded border-border accent-primary";
const TEXT_BUTTON =
  "inline-flex min-h-10 items-center rounded px-1.5 text-xs font-medium text-primary outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:text-muted-foreground disabled:no-underline sm:min-h-7";

function Option({
  option,
  checked,
  onToggle,
  showUnlisted,
}: {
  option: VariableOption;
  checked: boolean;
  onToggle: (name: string) => void;
  showUnlisted: boolean;
}) {
  return (
    <label className="flex min-h-10 cursor-pointer items-center gap-2 text-sm sm:min-h-8">
      <input type="checkbox" checked={checked} onChange={() => onToggle(option.name)} className={CHECKBOX} />
      <span className="min-w-0 truncate" title={option.title ?? option.name}>
        {option.name}
      </span>{" "}
      {!option.listed && showUnlisted && (
        <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          not in this snapshot
        </span>
      )}
    </label>
  );
}

const GRID = "grid grid-cols-1 gap-x-3 min-[420px]:grid-cols-2 sm:grid-cols-3";

/** One group's checkbox: ticked when all its variables are, dashed when some are. */
function GroupToggle({
  base,
  total,
  chosen,
  onChange,
}: {
  base: string;
  total: number;
  chosen: number;
  onChange: (on: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = chosen > 0 && chosen < total;
  }, [chosen, total]);
  return (
    <label className="flex min-h-10 cursor-pointer items-center gap-2 text-sm font-medium text-foreground sm:min-h-8">
      <input
        ref={ref}
        type="checkbox"
        checked={chosen === total}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={`${base}: all ${total} variables`}
        className={CHECKBOX}
      />
      {base}
      <span className="text-xs font-normal text-muted-foreground">
        {chosen} of {total}
      </span>
    </label>
  );
}

/** How many names the summary gives before "and N more". */
const SUMMARY_NAMES = 3;
/** A list this short has its names in the summary even when all are chosen. */
const SHORT_LIST = 6;

/** What is chosen, in one line: "All 51 variables", or "12 of 51 variables"
 *  with the first few names. */
function VariablesSummary({
  selected,
  total,
  hasSnapshot,
}: {
  selected: readonly string[];
  total: number;
  /** False when the snapshot's own list is unknown: there is no "all" to compare with. */
  hasSnapshot: boolean;
}) {
  if (selected.length === 0) return <span className="font-medium text-warning">None selected</span>;
  const all = hasSnapshot && selected.length >= total;
  const noun = (hasSnapshot ? total : selected.length) === 1 ? "variable" : "variables";
  const names =
    !all || total <= SHORT_LIST
      ? selected.slice(0, SUMMARY_NAMES).join(", ") +
        (selected.length > SUMMARY_NAMES ? ` and ${selected.length - SUMMARY_NAMES} more` : "")
      : null;
  return (
    <>
      <span className="font-medium">
        {all
          ? `All ${total} ${noun}`
          : hasSnapshot
            ? `${selected.length} of ${total} ${noun}`
            : `${selected.length} ${noun}`}
      </span>
      {names && <span className="text-muted-foreground"> · {names}</span>}
    </>
  );
}

/**
 * The output variables of a draft, as a part of Run settings that most people
 * leave alone: a line saying what is chosen (`VariablesSummary`) and a
 * "Choose…" button that opens the list to tick. What is wrong stays in view
 * with the list closed: none chosen, a message from the server. A variable the
 * snapshot does not list (stored in the draft, so it can be unticked) keeps the
 * list open, where it is marked.
 *
 * The list: a short one (up to `FLAT_LIST_LIMIT`) is just the checkboxes. A
 * longer one adds a search box, and groups the names that share a base
 * (`variable-groups.ts`: `runoff`, `runoff_ps`, `runoff_pu`) under a heading
 * that ticks the whole group; the names that share nothing follow as "Other
 * variables". "Select all" and "Clear" act on what is shown, so with a search
 * typed they act on the matches.
 *
 * `onChange` receives the whole new selection; the caller stores it in the
 * snapshot's order. An Edit link on Review opens the list and sends focus to the
 * search box of a long one, and to the first checkbox of a short one
 * (`draftField("variables")`).
 */
export function OutputVariablesSection({
  options,
  selected,
  hasSnapshot,
  onChange,
  describedBy,
  error,
  errorId,
}: {
  options: readonly VariableOption[];
  selected: readonly string[];
  /** False when the snapshot's own list is unknown: only the stored ones are here. */
  hasSnapshot: boolean;
  onChange: (names: string[]) => void;
  describedBy?: string;
  error?: string | null;
  errorId?: string;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const long = options.length > FLAT_LIST_LIMIT;
  const searching = long && query.trim() !== "";
  const shown = searching ? options.filter((o) => matchesVariable(o, query)) : options;
  const chosen = new Set(selected);
  const shownChosen = shown.filter((o) => chosen.has(o.name)).length;

  const toggle = (name: string) =>
    onChange(chosen.has(name) ? selected.filter((n) => n !== name) : [...selected, name]);
  const setMany = (names: readonly string[], on: boolean) => {
    const set = new Set(names);
    onChange(on ? [...new Set([...selected, ...names])] : selected.filter((n) => !set.has(n)));
  };

  const groups = long ? groupVariables(shown) : [{ base: null, items: [...shown] }];
  const grouped = long && groups.some((g) => g.base !== null);

  return (
    <DraftCollapsible
      title="Output variables"
      help="variables"
      fields={["variables"]}
      openLabel="Choose…"
      forceOpen={hasSnapshot && options.some((o) => !o.listed)}
      summary={<VariablesSummary selected={selected} total={options.length} hasSnapshot={hasSnapshot} />}
      notes={
        <>
          {selected.length === 0 && (
            <p className="flex items-start gap-2 text-xs text-warning">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              Choose at least one output variable. A snapshot draft with none can&apos;t be submitted.
            </p>
          )}
          {!hasSnapshot && selected.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Only the variables already chosen are listed: the model snapshot&apos;s own list isn&apos;t
              available.
            </p>
          )}
          {error && (
            <p id={errorId} className="text-xs text-destructive">
              {error}
            </p>
          )}
        </>
      }
    >
      <fieldset className="min-w-0 space-y-3" aria-describedby={describedBy}>
        <legend className="sr-only">Output variables</legend>
        {(long || options.length > 1) && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {long && (
              <div className="flex h-10 min-w-0 flex-1 basis-60 items-center gap-2 rounded-lg border bg-background px-3 transition-shadow focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 sm:h-9">
                <Search aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                <input
                  id={`${id}-search`}
                  {...draftField("variables")}
                  type="search"
                  aria-label="Search output variables"
                  placeholder="Search variables…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-cancel-button]:appearance-none"
                />
                {query !== "" && (
                  <button
                    type="button"
                    aria-label="Clear search"
                    onClick={() => setQuery("")}
                    className="-mr-2 inline-flex size-10 shrink-0 items-center justify-center rounded text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:size-8"
                  >
                    <X aria-hidden="true" className="size-4" />
                  </button>
                )}
              </div>
            )}
            {options.length > 1 && (
              <div className="ml-auto flex items-center gap-1">
                <button
                  type="button"
                  className={TEXT_BUTTON}
                  disabled={shownChosen === shown.length}
                  onClick={() => setMany(shown.map((o) => o.name), true)}
                >
                  {searching ? "Select shown" : "Select all"}
                </button>
                <button
                  type="button"
                  className={TEXT_BUTTON}
                  disabled={shownChosen === 0}
                  onClick={() => setMany(shown.map((o) => o.name), false)}
                >
                  {searching ? "Clear shown" : "Clear"}
                </button>
              </div>
            )}
          </div>
        )}

        {options.length === 0 ? (
          <p className="text-xs text-muted-foreground">No output variables are known for this draft.</p>
        ) : shown.length === 0 ? (
          <p role="status" className="text-sm text-muted-foreground">
            No variable matches &lsquo;{query.trim()}&rsquo;.
          </p>
        ) : (
          <div
            {...(long ? {} : draftField("variables"))}
            className={
              long
                ? "max-h-80 space-y-3 overflow-y-auto rounded-lg border p-3"
                : "rounded-lg border px-3 py-1"
            }
          >
            {groups.map((group) => {
              const names = group.items.map((o) => o.name);
              return (
                <div key={group.base ?? "other"} className={grouped ? "space-y-0.5" : undefined}>
                  {grouped &&
                    (group.base === null ? (
                      <p className="flex min-h-8 items-center text-sm font-medium text-foreground">
                        Other variables
                      </p>
                    ) : (
                      <GroupToggle
                        base={group.base}
                        total={group.items.length}
                        chosen={names.filter((n) => chosen.has(n)).length}
                        onChange={(on) => setMany(names, on)}
                      />
                    ))}
                  <div className={`${GRID} ${grouped ? "pl-6" : ""}`}>
                    {group.items.map((o) => (
                      <Option
                        key={o.name}
                        option={o}
                        checked={chosen.has(o.name)}
                        onToggle={toggle}
                        showUnlisted={hasSnapshot}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </fieldset>
    </DraftCollapsible>
  );
}
