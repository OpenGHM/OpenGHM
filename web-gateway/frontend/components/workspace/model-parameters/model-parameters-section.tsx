"use client";

import { useId, useState, type ComponentType, type ReactNode } from "react";
import {
  Blocks,
  ChevronDown,
  ChevronRight,
  CloudRain,
  Folder,
  Map as MapIcon,
  Package,
  RotateCcw,
  Search,
  Settings2,
  SlidersHorizontal,
  Sprout,
  Waves,
  X,
  type LucideProps,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { draftField } from "@/components/workspace/draft-field";
import { DraftCollapsible } from "@/components/workspace/draft-section";
import { ParamFieldRow } from "@/components/workspace/model-parameters/registry";
import { cn } from "@/lib/utils";
import {
  canonicalForks,
  forkAt,
  forkPaths,
  forkSummary,
  withFork,
  withoutFork,
  withoutForks,
  type DatasetFork,
} from "@/lib/workspace/dataset-forks";
import {
  changedBelow,
  chooseDataset,
  indexByPath,
  isSwitchedOn,
  moduleIsOn,
  pathsBelow,
  resetModule,
  resetPath,
  switchOffModule,
  switchOnModule,
  type CustomParams,
  type ParamField,
  type ParamGroup,
  type ParamModule,
  type ParamNode,
} from "@/lib/workspace/model-parameters";
import {
  analyzeTree,
  canToggleModule,
  isUnavailableModule,
  treeTotals,
  type FilterInput,
  type NodeInfo,
  type ParamFilter,
} from "@/lib/workspace/param-filter";
import type { ModelParametersState } from "@/lib/workspace/use-model-parameters";

/** What every node of the tree is drawn with. */
interface Ctx {
  custom: CustomParams | null;
  /** The datasets the draft edits as its own copy, by field. */
  forks: readonly DatasetFork[] | null;
  /** The snapshot, for the Edit dataset panel to read the originals of. */
  datasetId: string;
  /** The backend's message by init key path. */
  errors: Record<string, string>;
  /** Set the new `custom_params`, and the new forks when they change too (one call: two would
   *  each be written over the other). */
  update: (next: CustomParams | null, forks?: DatasetFork[] | null) => void;
  /** The modules the person switched on and has chosen nothing for yet: a block module is
   *  on in the draft by what it sets, so these are on only while the section is. */
  opened: ReadonlySet<string>;
  setOpened: (path: string, on: boolean) => void;
  /** What the search, the filter and "Show advanced" leave of every node. */
  info: ReadonlyMap<ParamNode, NodeInfo>;
  /** What `info` was made from. */
  input: FilterInput;
  /** The search text, trimmed: what a field row marks in its label. */
  query: string;
  /** The search or a filter is on: the group cards stay open, whatever was clicked. */
  narrowed: boolean;
  setShowAdvanced: (on: boolean) => void;
}

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

const FOCUS_RING = "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

/** Whether anything below `node` has a message from the backend. */
const hasErrorBelow = (node: ParamNode, errors: Record<string, string>) =>
  pathsBelow(node).some((path) => path in errors);

/** The icon of each top-level group of the tree, by its key. */
const GROUP_ICONS: Record<string, ComponentType<LucideProps>> = {
  run: Settings2,
  domain: MapIcon,
  routing: Waves,
  climate: CloudRain,
  land: Sprout,
  hydrology_params: SlidersHorizontal,
  modules: Blocks,
  other_blocks: Package,
};

/**
 * A switch: the checkbox is the switch itself, laid transparent over its own track (as in the
 * 0/1 flags of a field row), so it keeps its role, focus and label. The checkbox is 40 px tall
 * so it can be tapped; the track is 24.
 */
function SwitchBox({
  checked,
  disabled,
  onChange,
  ...aria
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (on: boolean) => void;
  "aria-label"?: string;
}) {
  return (
    <span className="relative h-6 w-10 shrink-0">
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="peer absolute -top-2 left-0 z-10 m-0 h-10 w-10 cursor-pointer opacity-0 disabled:cursor-not-allowed"
        {...aria}
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-full bg-input transition-colors peer-checked:bg-primary peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring/50 peer-disabled:opacity-50 peer-checked:[&>span]:translate-x-4"
      >
        <span className="absolute top-[3px] left-[3px] size-[18px] rounded-full bg-white shadow-xs transition-transform motion-reduce:transition-none" />
      </span>
    </span>
  );
}

/**
 * A level of the tree: its visible nodes in order, the fields of a run in one list divided by
 * thin lines, a group as a heading over what is in it, a module as a row. The modules that are
 * off and cannot be switched on here, with nothing changed in them, are gathered in one list at
 * the end. `depth` is how many headings deep the level is.
 */
function Level({ nodes, ctx, depth }: { nodes: readonly ParamNode[]; ctx: Ctx; depth: number }) {
  const shown = nodes.filter((node) => ctx.info.get(node)?.visible);
  const gathered = shown.filter(
    (node): node is ParamModule => node.kind === "module" && isUnavailableModule(node, ctx.input)
  );
  const blocks: ReactNode[] = [];
  let run: ParamField[] = [];
  const flush = () => {
    if (run.length === 0) return;
    blocks.push(
      <div key={`fields-${run[0].path}`} className="divide-y divide-border/60">
        {run.map((field) => (
          <FieldView key={field.path} field={field} ctx={ctx} />
        ))}
      </div>
    );
    run = [];
  };
  for (const node of shown) {
    if (node.kind === "module" && gathered.includes(node)) continue;
    if (node.kind === "field") run.push(node);
    else {
      flush();
      blocks.push(
        node.kind === "module" ? (
          <ModuleRow key={node.path} mod={node} ctx={ctx} depth={depth} />
        ) : (
          <SubGroup key={node.key} group={node} ctx={ctx} depth={depth + 1} />
        )
      );
    }
  }
  flush();
  if (gathered.length > 0) blocks.push(<UnavailableModules key="unavailable" modules={gathered} ctx={ctx} />);
  return <div className="space-y-4">{blocks}</div>;
}

/** A field, wired to the draft: a value goes to `custom_params` (and, for a dataset chosen from the
 *  model input, to the copy it needs), and its copy to `forks`. */
function FieldView({ field, ctx }: { field: ParamField; ctx: Ctx }) {
  return (
    <ParamFieldRow
      field={field}
      custom={ctx.custom}
      fork={forkAt(ctx.forks, field.path)}
      datasetId={ctx.datasetId}
      error={ctx.errors[field.path]}
      highlight={ctx.query || undefined}
      advanced={ctx.info.get(field)?.advanced || undefined}
      onChange={(value) => {
        const next = chooseDataset(ctx.custom, ctx.forks, field, value);
        if (JSON.stringify(next.forks) === JSON.stringify(canonicalForks(ctx.forks))) ctx.update(next.custom);
        else ctx.update(next.custom, next.forks);
      }}
      onReset={() => {
        const had = forkAt(ctx.forks, field.path) !== null;
        if (had) ctx.update(resetPath(ctx.custom, field.path), withoutFork(ctx.forks, field.path));
        else ctx.update(resetPath(ctx.custom, field.path));
      }}
      onForkChange={(fork) =>
        ctx.update(ctx.custom, fork === null ? withoutFork(ctx.forks, field.path) : withFork(ctx.forks, fork))
      }
    />
  );
}

/**
 * A group inside a group card: not a disclosure but a small heading (the group's label in
 * capitals, its help under it) over what is in it. A group inside it is the same, one size
 * smaller and a little indented. `depth` is the heading's own depth (1 for the first).
 */
function SubGroup({ group, ctx, depth }: { group: ParamGroup; ctx: Ctx; depth: number }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className={cn(depth > 1 && "pl-3")}>
      <h5
        id={headingId}
        className={cn(
          "font-semibold tracking-wide text-muted-foreground uppercase",
          depth > 1 ? "text-[11px]" : "text-[12px]"
        )}
      >
        {group.label}
      </h5>
      {group.doc && <p className="mt-0.5 text-[13px] leading-normal text-muted-foreground">{group.doc}</p>}
      <div className="mt-1.5">
        <Level nodes={group.children} ctx={ctx} depth={depth} />
      </div>
    </section>
  );
}

/** What a group card says under its title: the parameters and modules it shows now, and how many
 *  of them can be changed. */
function describeGroup(info: NodeInfo): string {
  const parts = [];
  if (info.fields > 0) parts.push(count(info.fields, "parameter"));
  if (info.modules > 0) parts.push(count(info.modules, "module"));
  if (info.editable > 0) parts.push(`${info.editable} editable`);
  return parts.join(" · ");
}

/**
 * A top-level group of the tree as a card: a header button with the group's icon, its title,
 * how many parameters (and modules) it shows now and how many of them can be changed, a pill
 * when the draft changes something in it, a dot when the backend has a message in it, and a
 * chevron. Under the header, the group's help and its nodes, and, when "Show advanced" is off
 * and the group has advanced parameters the filters would otherwise show, a button that turns
 * it on.
 *
 * It starts open when the draft already changes something in it; after that the person's own
 * clicks decide. A message from the backend below keeps it open, and so does a search or a
 * filter (what they find must not be hidden).
 */
function GroupCard({ group, ctx }: { group: ParamGroup; ctx: Ctx }) {
  const panelId = useId();
  const titleId = useId();
  const factsId = useId();
  const changedId = useId();
  const errorId = useId();
  const info = ctx.info.get(group);
  const changed = changedBelow(group, ctx.custom, ctx.forks).length;
  const failed = hasErrorBelow(group, ctx.errors);
  const [initiallyOpen] = useState(changed > 0);
  const [chosen, setChosen] = useState<boolean | null>(null);
  const open = failed || ctx.narrowed || (chosen ?? initiallyOpen);
  const Icon = GROUP_ICONS[group.key] ?? Folder;
  const hidden = info?.hiddenAdvanced ?? 0;
  if (!info?.visible) return null;
  return (
    <div className="rounded-xl border border-border/70 bg-card">
      <h4 className="m-0">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          aria-labelledby={titleId}
          aria-describedby={[factsId, changed > 0 ? changedId : null, failed ? errorId : null].filter(Boolean).join(" ")}
          onClick={() => setChosen(!open)}
          className={cn(
            "flex min-h-14 w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-left transition-colors hover:bg-muted/40 motion-reduce:transition-none",
            FOCUS_RING
          )}
        >
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
            <Icon className="size-4" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span id={titleId} className="block text-[14.5px] leading-snug font-semibold break-words text-foreground">
              {group.label}
            </span>
            <span id={factsId} className="block text-xs text-muted-foreground">
              {describeGroup(info)}
            </span>
          </span>
          {changed > 0 && (
            <span
              id={changedId}
              className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary"
            >
              {changed} changed
            </span>
          )}
          {failed && (
            <span id={errorId} className="shrink-0">
              <span aria-hidden="true" className="block size-2 rounded-full bg-destructive" />
              <span className="sr-only">Has a message from the backend</span>
            </span>
          )}
          <ChevronDown
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none",
              open && "rotate-180"
            )}
            aria-hidden="true"
          />
        </button>
      </h4>
      {open && (
        <div id={panelId} className="space-y-4 border-t border-border/70 px-3.5 py-4 sm:px-4">
          {group.doc && <p className="text-[13px] leading-normal text-muted-foreground">{group.doc}</p>}
          <Level nodes={group.children} ctx={ctx} depth={0} />
          {hidden > 0 && (
            <button
              type="button"
              onClick={() => ctx.setShowAdvanced(true)}
              className={cn(
                "inline-flex min-h-10 items-center rounded-md px-1 text-[13px] font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline sm:min-h-8",
                FOCUS_RING
              )}
            >
              Show {hidden} advanced
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** The one field of a module that is itself a dataset (`Impervious`): the module's own key, a
 *  choice among its candidates and, where it takes a number, a constant. */
function ownDatasetField(mod: ParamModule): ParamField | null {
  const candidates = mod.candidates ?? [];
  if (candidates.length === 0 && mod.edit_as !== "number") return null;
  return {
    kind: "field",
    key: mod.key,
    label: "Dataset",
    doc: null,
    tier: mod.tier,
    path: mod.path,
    type: "dataset",
    editable: true,
    required: true,
    forkable: mod.forkable === true,
    edit_as: mod.edit_as ?? null,
    candidates,
    current: null,
    default: null,
    unit: null,
    options: null,
    min: null,
    max: null,
    calibration: null,
    calibration_source: null,
    show_if: null,
  };
}

/** A text that is clamped to two lines when it is long, with a More / Less button. */
function ClampedText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const long = text.length > 160;
  return (
    <div>
      <p className={cn("text-[13px] leading-normal text-muted-foreground", long && !expanded && "line-clamp-2")}>
        {text}
      </p>
      {long && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          className={cn(
            "inline-flex min-h-8 items-center rounded px-0.5 text-xs font-medium text-primary hover:underline",
            FOCUS_RING
          )}
        >
          {expanded ? "Less" : "More"}
        </button>
      )}
    </div>
  );
}

/**
 * A module the init can have on, as a row: its name, its init key and a state pill ("On",
 * "Switched on", "Switched off", "Off"), a "Changed" marker when the draft changes it, and a
 * switch. The switch is on while the module is on. On a module the snapshot has on and the tree
 * lets be switched off, turning it off writes `""` on the module's key. On a module the draft
 * switched off, turning it on is a Reset. On a module the snapshot has off, turning it on is
 * allowed when the backend says everything it requires can be chosen from the model input
 * (`switch_on`): its parameters appear, its required datasets to be chosen. Turning off a
 * module the draft switched on is a Reset: everything set of it goes, and the copies of its
 * datasets. The switch is disabled where none applies.
 *
 * While it is on, the module's own dataset (`Impervious`) and its settings are drawn under it,
 * in place.
 */
function ModuleRow({ mod, ctx, depth }: { mod: ParamModule; ctx: Ctx; depth: number }) {
  const on = moduleIsOn(mod, ctx.custom, ctx.opened);
  const switchedOff = mod.state === "on" && !on;
  const switchedOn = isSwitchedOn(mod, ctx.custom, ctx.opened);
  const error = ctx.errors[mod.path];
  const changed = switchedOff || switchedOn || changedBelow(mod, ctx.custom, ctx.forks).length > 0;
  const status = on ? (switchedOn ? "Switched on" : "On") : switchedOff ? "Switched off" : "Off";
  const own = switchedOn ? ownDatasetField(mod) : null;
  const hasSettings = on && mod.children.some((child) => ctx.info.get(child)?.visible);

  const toggle = (next: boolean) => {
    if (next) {
      if (switchedOff) ctx.update(resetPath(ctx.custom, mod.path));
      else if (mod.state === "off" && mod.switch_on) {
        ctx.setOpened(mod.path, true);
        ctx.update(switchOnModule(ctx.custom, mod));
      }
    } else if (switchedOn) {
      ctx.setOpened(mod.path, false);
      updateBelow(ctx, resetModule(ctx.custom, mod), mod);
    } else if (on && mod.switch_off) {
      updateBelow(ctx, switchOffModule(ctx.custom, mod), mod);
    }
  };

  return (
    <div
      data-param-path={mod.path}
      data-changed={changed || undefined}
      className={cn(
        "rounded-xl border px-3.5 py-3",
        changed ? "border-primary/50 bg-primary/[0.03]" : "border-border/70 bg-muted/20"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h4 className="text-[14.5px] font-semibold text-foreground">{mod.name}</h4>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                on ? (switchedOn ? "bg-primary/10 text-primary" : "bg-success/10 text-success") : switchedOff ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
              )}
            >
              {status}
            </span>
            {changed && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">Changed</span>
            )}
          </div>
          <code className="block font-mono text-[11.5px] break-all text-muted-foreground">{mod.path}</code>
        </div>
        <span className="flex min-h-6 items-center pt-0.5">
          <SwitchBox
            aria-label={mod.name}
            checked={on}
            disabled={!canToggleModule(mod, ctx.custom, ctx.opened)}
            onChange={toggle}
          />
        </span>
      </div>
      {mod.doc && (
        <div className="mt-1.5">
          <ClampedText text={mod.doc} />
        </div>
      )}
      {error && <p className="mt-1.5 text-xs text-destructive">{error}</p>}
      {(own || hasSettings) && (
        <div className="mt-3 space-y-4 border-t border-border/60 pt-1">
          {own && (
            <div className="divide-y divide-border/60">
              <FieldView field={own} ctx={ctx} />
            </div>
          )}
          {hasSettings && <Level nodes={mod.children} ctx={ctx} depth={depth} />}
        </div>
      )}
    </div>
  );
}

/**
 * The modules of a level that are off and cannot be switched on here, in one quiet disclosure
 * ("3 modules can't be switched on here"). Opened, each is one line: its name and the reason
 * the backend gives. A search that finds one opens the list.
 */
function UnavailableModules({ modules, ctx }: { modules: readonly ParamModule[]; ctx: Ctx }) {
  const panelId = useId();
  const [chosen, setChosen] = useState<boolean | null>(null);
  const open = chosen ?? ctx.query !== "";
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setChosen(!open)}
        className={cn(
          "flex min-h-10 items-center gap-1.5 rounded-md px-1 text-left text-[13px] font-medium text-muted-foreground hover:text-foreground sm:min-h-8",
          FOCUS_RING
        )}
      >
        <ChevronRight
          className={cn("size-4 shrink-0 transition-transform motion-reduce:transition-none", open && "rotate-90")}
          aria-hidden="true"
        />
        {modules.length === 1 ? "1 module can't be switched on here" : `${modules.length} modules can't be switched on here`}
      </button>
      {open && (
        <ul
          id={panelId}
          className="mt-1 divide-y divide-border/60 rounded-xl border border-border/60 bg-muted/20"
        >
          {modules.map((mod) => (
            <li key={mod.path} data-param-path={mod.path} className="px-3.5 py-2">
              <span className="block text-[13px] font-medium text-foreground">{mod.name}</span>
              {mod.switch_on_reason && (
                <span className="block text-xs leading-normal text-muted-foreground">{mod.switch_on_reason}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Set `custom` for a module's reset or switch-off, and drop the copies of the datasets below it
 *  (a module that is off, or back to the snapshot's, reads no dataset of the draft's). */
function updateBelow(ctx: Ctx, custom: CustomParams | null, mod: ParamModule) {
  const below = pathsBelow(mod);
  if (forkPaths(ctx.forks).some((path) => below.includes(path))) ctx.update(custom, withoutForks(ctx.forks, below));
  else ctx.update(custom);
}

/** Changes the tree has no field for (or no tree to say): shown as they are,
 *  each with a Remove, so a draft can always be cleaned up. */
function ExtraEntries({
  keys,
  ctx,
  title,
}: {
  keys: readonly string[];
  ctx: Pick<Ctx, "custom" | "forks" | "errors" | "update">;
  title: string;
}) {
  if (keys.length === 0) return null;
  return (
    <div className="space-y-1.5 rounded-[14px] bg-muted/70 px-3.5 py-3">
      <p className="text-[13px] font-semibold text-foreground">{title}</p>
      <ul className="space-y-1.5">
        {keys.map((key) => {
          const fork = forkAt(ctx.forks, key);
          return (
            <li key={key} className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <code className="block font-mono text-xs break-all text-foreground">
                  {fork && ctx.custom?.[key] === undefined
                    ? `${key}: ${forkSummary(fork)}`
                    : `${key} = ${ctx.custom?.[key] === "" ? "(switched off)" : ctx.custom?.[key]}`}
                </code>
                {ctx.errors[key] && <p className="text-xs text-destructive">{ctx.errors[key]}</p>}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label={`Remove ${key}`}
                className="min-h-10 shrink-0 sm:min-h-8"
                onClick={() =>
                  fork
                    ? ctx.update(resetPath(ctx.custom, key), withoutFork(ctx.forks, key))
                    : ctx.update(resetPath(ctx.custom, key))
                }
              >
                Remove
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const FILTERS: readonly { value: ParamFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "editable", label: "Editable" },
  { value: "changed", label: "Changed" },
];

/**
 * What sits above the groups: a search box (Escape or the X clears it), the All / Editable /
 * Changed filter, the "Show advanced" switch with how many advanced parameters there are, and,
 * once the draft changes anything, "Reset all", which asks first. It wraps on a narrow screen;
 * the filter then takes the full width.
 */
function ParamToolbar({
  query,
  onQuery,
  filter,
  onFilter,
  changed,
  showAdvanced,
  onShowAdvanced,
  advancedTotal,
  onResetAll,
}: {
  query: string;
  onQuery: (query: string) => void;
  filter: ParamFilter;
  onFilter: (filter: ParamFilter) => void;
  /** How many parameters the draft changes. */
  changed: number;
  showAdvanced: boolean;
  onShowAdvanced: (on: boolean) => void;
  advancedTotal: number;
  onResetAll: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-60">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            value={query}
            autoComplete="off"
            spellCheck={false}
            placeholder="Search parameters or init keys"
            aria-label="Search model parameters"
            className="h-10 rounded-lg pr-10 pl-9 [&::-webkit-search-cancel-button]:hidden"
            onChange={(e) => onQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && query !== "") {
                e.preventDefault();
                onQuery("");
              }
            }}
          />
          {query !== "" && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => onQuery("")}
              className={cn(
                "absolute top-1/2 right-1 grid size-8 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground",
                FOCUS_RING
              )}
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          )}
        </div>
        {changed > 0 && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-10 sm:min-h-8"
            onClick={() => setConfirming(true)}
          >
            <RotateCcw aria-hidden="true" />
            Reset all
          </Button>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div role="group" aria-label="Show parameters" className="flex w-full rounded-lg bg-muted p-0.5 sm:w-auto">
          {FILTERS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              onClick={() => onFilter(value)}
              className={cn(
                "inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-md px-3.5 text-[13px] font-medium transition-colors motion-reduce:transition-none sm:min-h-8 sm:flex-none",
                FOCUS_RING,
                filter === value ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {label}
              {value === "changed" && (
                <>
                  {" "}
                  <span
                    className={cn(
                      "rounded-full px-1.5 text-[11px] font-semibold tabular-nums",
                      changed > 0 ? "bg-primary/10 text-primary" : "text-muted-foreground"
                    )}
                  >
                    {changed}
                  </span>
                </>
              )}
            </button>
          ))}
        </div>
        {advancedTotal > 0 && (
          <label className="flex min-h-10 cursor-pointer items-center gap-2.5 text-[13px] font-medium text-foreground sm:min-h-8">
            <SwitchBox checked={showAdvanced} onChange={onShowAdvanced} />
            <span>
              Show advanced <span className="font-normal text-muted-foreground tabular-nums">· {advancedTotal}</span>
            </span>
          </label>
        )}
      </div>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset all model parameters?</AlertDialogTitle>
            <AlertDialogDescription>
              {count(changed, "change")} will be removed, and every model parameter goes back to the snapshot&apos;s value.
              Modules return to how the snapshot has them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-10 sm:min-h-9">Keep changes</AlertDialogCancel>
            <AlertDialogAction
              onClick={onResetAll}
              className={cn(
                buttonVariants({ variant: "outline" }),
                "min-h-10 border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive sm:min-h-9"
              )}
            >
              Reset all
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** What the section says when the search and the filter leave nothing: why, and a button that
 *  clears them (or, when everything left is advanced, shows it). */
function EmptyResult({
  query,
  filter,
  hiddenAdvanced,
  onClear,
  onShowAdvanced,
}: {
  query: string;
  filter: ParamFilter;
  hiddenAdvanced: number;
  onClear: () => void;
  onShowAdvanced: () => void;
}) {
  let message: string;
  let action: { label: string; run: () => void };
  if (query !== "") {
    message = `No parameters match “${query}”.`;
    action = { label: filter === "all" ? "Clear search" : "Clear search and filter", run: onClear };
  } else if (filter === "changed") {
    message = "No changed parameters yet.";
    action = { label: "Show all", run: onClear };
  } else if (filter === "editable") {
    message = "No editable parameters here.";
    action = { label: "Show all", run: onClear };
  } else if (hiddenAdvanced > 0) {
    message = "Everything here is advanced.";
    action = { label: `Show ${hiddenAdvanced} advanced`, run: onShowAdvanced };
  } else {
    return null;
  }
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border/70 px-4 py-8 text-center">
      <p className="text-[13px] text-muted-foreground">{message}</p>
      <Button type="button" variant="outline" size="sm" className="min-h-10 sm:min-h-8" onClick={action.run}>
        {action.label}
      </Button>
    </div>
  );
}

/**
 * The "Model parameters" part of Run settings: the parameters WBM reads from the
 * init, as the gateway's tree has them for this snapshot's WBM version. It is closed
 * until asked for, with a line that says the code version and how many parameters the
 * draft changes; an open message from the backend keeps it open.
 *
 * Open, it has a toolbar (search, All / Editable / Changed, Show advanced, Reset all) over
 * one card per top-level group; see `ParamToolbar` and `GroupCard`. Advanced parameters are
 * hidden until "Show advanced" is on, unless they hold a change, a copy or a message, or a
 * search is on.
 *
 * Every change is `custom_params[init key path] = text` (`onChange` gets the new
 * whole object, or null for none): a field's value, `""` for a module switched
 * off. A value that equals the snapshot's is not kept. Reset takes a key out.
 *
 * `errors` is the backend's message by key path (`invalid_custom_params`) and
 * `error` its message for the whole set. Where the tree could not be read the
 * rest of the wizard is untouched: the section says so, offers Retry, and
 * still lists the draft's changes so they can be removed.
 */
export function ModelParametersSection({
  state,
  datasetId = "",
  custom,
  forks = null,
  errors = {},
  error = null,
  onChange,
  onRetry,
}: {
  state: ModelParametersState;
  /** The snapshot, which the Edit dataset panel reads the original datasets of. */
  datasetId?: string;
  custom: CustomParams | null;
  /** The datasets the draft edits as the run's own copy (ADR 0039), by field. */
  forks?: readonly DatasetFork[] | null;
  errors?: Record<string, string>;
  error?: string | null;
  /** The new `custom_params`; a second argument only when the forks change with them (a
   *  dataset's copy is made, kept or dropped), else `undefined` and the forks stay. */
  onChange: (custom: CustomParams | null, forks?: DatasetFork[] | null) => void;
  onRetry?: () => void;
}) {
  const changed = new Set([...Object.keys(custom ?? {}), ...forkPaths(forks)]).size;
  const [opened, setOpenedSet] = useState<ReadonlySet<string>>(new Set());
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ParamFilter>("all");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const setOpened = (path: string, on: boolean) =>
    setOpenedSet((prev) => {
      const next = new Set(prev);
      if (on) next.add(path);
      else next.delete(path);
      return next;
    });
  const trimmed = query.trim();
  const input: FilterInput = { query: trimmed, filter, showAdvanced, custom, forks, errors, opened };
  const nodes = state.status === "ready" ? state.tree.groups : [];
  const info = analyzeTree(nodes, input);
  const totals = treeTotals(nodes, info);
  const ctx: Ctx = {
    custom,
    forks,
    datasetId,
    errors,
    update: onChange,
    opened,
    setOpened,
    info,
    input,
    query: trimmed,
    narrowed: trimmed !== "" || filter !== "all",
    setShowAdvanced,
  };
  const known = state.status === "ready" ? indexByPath(state.tree) : null;
  const extraKeys = [...new Set([...Object.keys(custom ?? {}), ...forkPaths(forks)])].filter((key) => !known?.has(key));
  // A message for a key the tree lacks is shown with that key, and one for a
  // key that is not even in the draft has nowhere to be: it is listed.
  const strayErrors = Object.entries(errors).filter(
    ([path]) => !(custom && path in custom) && !forkAt(forks, path) && !known?.has(path)
  );
  const changedText = changed === 0 ? "No parameters changed" : `${count(changed, "parameter")} changed`;
  const resetAll = () => {
    setOpenedSet(new Set());
    onChange(null, null);
  };
  const clearFilters = () => {
    setQuery("");
    setFilter("all");
  };

  let summary: ReactNode;
  let body: ReactNode;
  if (state.status === "ready") {
    summary = `WBM ${state.tree.code_version} · ${changedText}`;
    const groups = nodes.filter((node): node is ParamGroup => node.kind === "group");
    const loose = nodes.filter((node) => node.kind !== "group");
    const shown = totals.fields + totals.modules;
    body = (
      <>
        <ParamToolbar
          query={query}
          onQuery={setQuery}
          filter={filter}
          onFilter={setFilter}
          changed={changed}
          showAdvanced={showAdvanced}
          onShowAdvanced={setShowAdvanced}
          advancedTotal={totals.advancedTotal}
          onResetAll={resetAll}
        />
        {ctx.narrowed && (
          <p role="status" className="sr-only">
            {shown === 0 ? "Nothing matches" : `${count(shown, "item")} shown`}
          </p>
        )}
        <div className="space-y-3">
          {groups.map((group) => (
            <GroupCard key={group.key} group={group} ctx={ctx} />
          ))}
          {loose.some((node) => info.get(node)?.visible) && (
            <div className="rounded-xl border border-border/70 bg-card px-3.5 py-4 sm:px-4">
              <Level nodes={loose} ctx={ctx} depth={0} />
            </div>
          )}
          {shown === 0 && (
            <EmptyResult
              query={trimmed}
              filter={filter}
              hiddenAdvanced={totals.hiddenAdvanced}
              onClear={clearFilters}
              onShowAdvanced={() => setShowAdvanced(true)}
            />
          )}
        </div>
        <ExtraEntries keys={extraKeys} ctx={ctx} title="Changes this snapshot's tree has no field for" />
      </>
    );
  } else if (state.status === "loading") {
    summary = changed > 0 ? `Loading the parameters · ${changedText}` : "Loading the parameters…";
    body = (
      <div role="status" aria-busy="true" className="space-y-3">
        <span className="sr-only">Loading the model parameters…</span>
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  } else {
    summary = state.status === "unavailable" ? "Not available for this snapshot" : "Could not be loaded";
    if (changed > 0) summary = `${summary} · ${changedText}`;
    body = (
      <>
        <div role="status" className="space-y-2 text-[13px] text-muted-foreground">
          <p>
            {state.status === "unavailable"
              ? "The model parameters can't be shown right now: this snapshot's init could not be read. You can still set everything else and submit."
              : state.message}
          </p>
          {onRetry && (
            <Button type="button" variant="outline" size="sm" className="min-h-10 sm:min-h-8" onClick={onRetry}>
              Try again
            </Button>
          )}
        </div>
        <ExtraEntries keys={extraKeys} ctx={ctx} title="This draft changes" />
      </>
    );
  }

  const notes = (
    <>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {strayErrors.length > 0 && (
        <ul className="space-y-0.5 text-xs text-destructive">
          {strayErrors.map(([path, message]) => (
            <li key={path} className="break-words">
              <code className="font-mono">{path}</code>: {message}
            </li>
          ))}
        </ul>
      )}
    </>
  );

  return (
    <DraftCollapsible
      title="Model parameters"
      help="parameters"
      summary={summary}
      notes={notes}
      fields={["custom"]}
      openLabel="Edit…"
      forceOpen={Object.keys(errors).length > 0 || error !== null}
    >
      <div {...draftField("custom")} className="space-y-3">
        {body}
      </div>
    </DraftCollapsible>
  );
}
