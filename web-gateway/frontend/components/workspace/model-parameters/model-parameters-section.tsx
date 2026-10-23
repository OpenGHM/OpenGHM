"use client";

import { useId, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { draftField } from "@/components/workspace/draft-field";
import { DraftCollapsible } from "@/components/workspace/draft-section";
import { ParamFieldRow } from "@/components/workspace/model-parameters/registry";
import { cn } from "@/lib/utils";
import {
  changedBelow,
  indexByPath,
  isSwitchedOn,
  moduleIsOn,
  pathsBelow,
  resetModule,
  resetPath,
  setFieldValue,
  switchOffModule,
  switchOnModule,
  type CustomParams,
  type ParamField,
  type ParamGroup,
  type ParamModule,
  type ParamNode,
} from "@/lib/workspace/model-parameters";
import type { ModelParametersState } from "@/lib/workspace/use-model-parameters";

/** What every node of the tree is drawn with. */
interface Ctx {
  custom: CustomParams | null;
  /** The backend's message by init key path. */
  errors: Record<string, string>;
  update: (next: CustomParams | null) => void;
  /** The modules the person switched on and has chosen nothing for yet: a block module is
   *  on in the draft by what it sets, so these are on only while the section is. */
  opened: ReadonlySet<string>;
  setOpened: (path: string, on: boolean) => void;
}

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/** Whether anything below `node` has a message from the backend. */
const hasErrorBelow = (node: ParamNode, errors: Record<string, string>) =>
  pathsBelow(node).some((path) => path in errors);

/**
 * A heading with a chevron that opens what is under it. It stays open while
 * `forceOpen` (a message inside must not be hidden) and starts open when
 * `openOnMount` (a draft that already changes something in it); after that the
 * person's own clicks decide.
 */
function Disclosure({
  title,
  meta,
  forceOpen = false,
  openOnMount = false,
  tone = "group",
  children,
}: {
  title: string;
  /** Muted text after the title: "2 changed". */
  meta?: ReactNode;
  forceOpen?: boolean;
  openOnMount?: boolean;
  tone?: "group" | "quiet";
  children: ReactNode;
}) {
  const panelId = useId();
  const [initiallyOpen] = useState(openOnMount);
  const [chosen, setChosen] = useState<boolean | null>(null);
  const open = forceOpen || (chosen ?? initiallyOpen);
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setChosen(!open)}
        className={cn(
          "flex min-h-10 w-full items-center gap-2 rounded-lg px-1 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:min-h-9",
          tone === "group"
            ? "text-[14.5px] font-semibold text-foreground"
            : "text-[13px] font-medium text-muted-foreground hover:text-foreground"
        )}
      >
        <ChevronRight
          className={cn("size-4 shrink-0 transition-transform motion-reduce:transition-none", open && "rotate-90")}
          aria-hidden="true"
        />
        <span className="min-w-0 break-words">{title}</span>
        {meta && <span className="text-xs font-normal text-muted-foreground">{meta}</span>}
      </button>
      {open && (
        <div id={panelId} className="ml-2 border-l border-border/70 pl-3">
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * The nodes of one level: the basic ones, then the advanced ones behind an
 * "Advanced" disclosure. `inline` (the level belongs to an advanced group or
 * module, or sits in an Advanced disclosure already) draws every node in
 * place: "Advanced" is never nested in itself.
 */
function Nodes({ nodes, ctx, inline = false }: { nodes: readonly ParamNode[]; ctx: Ctx; inline?: boolean }) {
  if (inline) {
    return (
      <>
        {nodes.map((node) => (
          <NodeView key={node.key} node={node} ctx={ctx} inline />
        ))}
      </>
    );
  }
  const advanced = nodes.filter((n) => n.tier === "advanced");
  const basic = nodes.filter((n) => n.tier !== "advanced");
  const changed = advanced.reduce((n, node) => n + changedBelow(node, ctx.custom).length, 0);
  return (
    <>
      {basic.map((node) => (
        <NodeView key={node.key} node={node} ctx={ctx} />
      ))}
      {advanced.length > 0 && (
        <Disclosure
          title="Advanced"
          tone="quiet"
          meta={changed > 0 ? `${changed} changed` : undefined}
          openOnMount={changed > 0}
          forceOpen={advanced.some((n) => hasErrorBelow(n, ctx.errors))}
        >
          {advanced.map((node) => (
            <NodeView key={node.key} node={node} ctx={ctx} inline />
          ))}
        </Disclosure>
      )}
    </>
  );
}

/** `inline`: this node is already inside an Advanced disclosure. */
function NodeView({ node, ctx, inline = false }: { node: ParamNode; ctx: Ctx; inline?: boolean }) {
  if (node.kind === "field") {
    return (
      <ParamFieldRow
        field={node}
        custom={ctx.custom}
        error={ctx.errors[node.path]}
        onChange={(value) => ctx.update(setFieldValue(ctx.custom, node, value))}
        onReset={() => ctx.update(resetPath(ctx.custom, node.path))}
      />
    );
  }
  if (node.kind === "module") return <ModuleCard mod={node} ctx={ctx} inline={inline} />;
  return <GroupView group={node} ctx={ctx} inline={inline} />;
}

function GroupView({ group, ctx, inline }: { group: ParamGroup; ctx: Ctx; inline: boolean }) {
  const changed = changedBelow(group, ctx.custom).length;
  return (
    <Disclosure
      title={group.label}
      meta={changed > 0 ? `${changed} changed` : undefined}
      openOnMount={changed > 0}
      forceOpen={hasErrorBelow(group, ctx.errors)}
    >
      {group.doc && <p className="pb-1 text-[13px] leading-normal text-muted-foreground">{group.doc}</p>}
      <Nodes nodes={group.children} ctx={ctx} inline={inline || group.tier === "advanced"} />
    </Disclosure>
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
    edit_as: mod.edit_as ?? null,
    candidates,
    current: null,
    default: null,
    unit: null,
    options: null,
    min: null,
    max: null,
    calibration: null,
    show_if: null,
  };
}

/**
 * A module the init can have on: a card with its state, a "Switch off" when the
 * tree allows it (`""` on the module's key), and its own parameters while it is
 * on. A module switched off here says so and has a Reset. A module the snapshot has
 * off has a "Switch on" when the backend says everything it requires can be chosen
 * from the model input (`switch_on`): the module's parameters appear, its required
 * datasets to be chosen, and Reset takes it back off. Where it cannot, the card says why.
 */
function ModuleCard({ mod, ctx, inline }: { mod: ParamModule; ctx: Ctx; inline: boolean }) {
  const on = moduleIsOn(mod, ctx.custom, ctx.opened);
  const switchedOff = mod.state === "on" && !on;
  const switchedOn = isSwitchedOn(mod, ctx.custom, ctx.opened);
  const error = ctx.errors[mod.path];
  const changed = changedBelow(mod, ctx.custom).length;
  const status = on ? (switchedOn ? "Switched on" : "On") : switchedOff ? "Switched off" : "Off in this snapshot";
  const own = switchedOn ? ownDatasetField(mod) : null;
  const button = (label: string, run: () => void) => (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-label={`${label} ${mod.name}`}
      className="min-h-10 sm:min-h-8"
      onClick={run}
    >
      {label}
    </Button>
  );
  const action = switchedOff
    ? button("Reset", () => ctx.update(resetPath(ctx.custom, mod.path)))
    : switchedOn
      ? button("Reset", () => {
          ctx.setOpened(mod.path, false);
          ctx.update(resetModule(ctx.custom, mod));
        })
      : on && mod.switch_off
        ? button("Switch off", () => ctx.update(switchOffModule(ctx.custom, mod)))
        : mod.state === "off" && mod.switch_on
          ? button("Switch on", () => {
              ctx.setOpened(mod.path, true);
              ctx.update(switchOnModule(ctx.custom, mod));
            })
          : null;
  const cannot = mod.state === "off" && !on && !mod.switch_on && mod.switch_on_reason;

  return (
    <div
      data-param-path={mod.path}
      data-changed={switchedOff || switchedOn || undefined}
      className={cn(
        "my-2 space-y-1 rounded-[14px] border px-3.5 py-3",
        switchedOff || switchedOn ? "border-primary/50" : "border-border/70"
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <h4 className="text-[14.5px] font-semibold text-foreground">{mod.name}</h4>
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[11px] font-semibold",
              on
                ? switchedOn
                  ? "bg-primary/10 text-primary"
                  : "bg-success/10 text-success"
                : switchedOff
                  ? "bg-primary/10 text-primary"
                  : "bg-muted text-muted-foreground"
            )}
          >
            {status}
          </span>
        </div>
        {action}
      </div>
      <code className="block font-mono text-[11.5px] break-all text-muted-foreground">{mod.path}</code>
      {mod.doc && <p className="text-[13px] leading-normal text-muted-foreground">{mod.doc}</p>}
      {cannot && <p className="text-[13px] leading-normal text-muted-foreground">Can&apos;t be switched on here. {mod.switch_on_reason}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
      {own && (
        <ParamFieldRow
          field={own}
          custom={ctx.custom}
          onChange={(value) => ctx.update(setFieldValue(ctx.custom, own, value))}
          onReset={() => ctx.update(resetPath(ctx.custom, own.path))}
        />
      )}
      {on && mod.children.length > 0 && (
        <Disclosure
          title="Settings"
          tone="quiet"
          meta={changed > 0 ? `${changed} changed` : undefined}
          openOnMount={changed > 0 || switchedOn}
          forceOpen={mod.children.some((n) => hasErrorBelow(n, ctx.errors))}
        >
          <Nodes nodes={mod.children} ctx={ctx} inline={inline || mod.tier === "advanced"} />
        </Disclosure>
      )}
    </div>
  );
}

/** Changes the tree has no field for (or no tree to say): shown as they are,
 *  each with a Remove, so a draft can always be cleaned up. */
function ExtraEntries({
  keys,
  ctx,
  title,
}: {
  keys: readonly string[];
  ctx: Ctx;
  title: string;
}) {
  if (keys.length === 0) return null;
  return (
    <div className="space-y-1.5 rounded-[14px] bg-muted/70 px-3.5 py-3">
      <p className="text-[13px] font-semibold text-foreground">{title}</p>
      <ul className="space-y-1.5">
        {keys.map((key) => (
          <li key={key} className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <code className="block font-mono text-xs break-all text-foreground">
                {key} = {ctx.custom?.[key] === "" ? "(switched off)" : ctx.custom?.[key]}
              </code>
              {ctx.errors[key] && <p className="text-xs text-destructive">{ctx.errors[key]}</p>}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label={`Remove ${key}`}
              className="min-h-10 shrink-0 sm:min-h-8"
              onClick={() => ctx.update(resetPath(ctx.custom, key))}
            >
              Remove
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The "Model parameters" part of Run settings: the parameters WBM reads from the
 * init, as the gateway's tree has them for this snapshot's WBM version, grouped
 * as the tree groups them. It is closed until asked for, with a line that says
 * the code version and how many parameters the draft changes; an open message
 * from the backend keeps it open.
 *
 * Every change is `custom_params[init key path] = text` (`onChange` gets the new
 * whole object, or null for none): a field's value, `""` for a module switched
 * off. A value that equals the snapshot's is not kept. Reset takes a key out.
 * Basic parameters come first in their group, the advanced ones behind an
 * "Advanced" disclosure (one, at the top level or in a basic group; nothing
 * below an advanced group or disclosure has another); a group that already
 * holds a change starts open.
 *
 * `errors` is the backend's message by key path (`invalid_custom_params`) and
 * `error` its message for the whole set. Where the tree could not be read the
 * rest of the wizard is untouched: the section says so, offers Retry, and
 * still lists the draft's changes so they can be removed.
 */
export function ModelParametersSection({
  state,
  custom,
  errors = {},
  error = null,
  onChange,
  onRetry,
}: {
  state: ModelParametersState;
  custom: CustomParams | null;
  errors?: Record<string, string>;
  error?: string | null;
  onChange: (custom: CustomParams | null) => void;
  onRetry?: () => void;
}) {
  const changed = custom ? Object.keys(custom).length : 0;
  const [opened, setOpenedSet] = useState<ReadonlySet<string>>(new Set());
  const setOpened = (path: string, on: boolean) =>
    setOpenedSet((prev) => {
      const next = new Set(prev);
      if (on) next.add(path);
      else next.delete(path);
      return next;
    });
  const ctx: Ctx = { custom, errors, update: onChange, opened, setOpened };
  const known = state.status === "ready" ? indexByPath(state.tree) : null;
  const extraKeys = Object.keys(custom ?? {}).filter((key) => !known?.has(key));
  // A message for a key the tree lacks is shown with that key, and one for a
  // key that is not even in the draft has nowhere to be: it is listed.
  const strayErrors = Object.entries(errors).filter(([path]) => !(custom && path in custom) && !known?.has(path));
  const changedText = changed === 0 ? "No parameters changed" : `${count(changed, "parameter")} changed`;

  let summary: ReactNode;
  let body: ReactNode;
  if (state.status === "ready") {
    summary = `WBM ${state.tree.code_version} · ${changedText}`;
    body = (
      <>
        <Nodes nodes={state.tree.groups} ctx={ctx} />
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
      summary={summary}
      notes={notes}
      fields={["custom"]}
      openLabel="Edit…"
      forceOpen={Object.keys(errors).length > 0 || error !== null}
    >
      <div {...draftField("custom")} className="space-y-2">
        {body}
      </div>
    </DraftCollapsible>
  );
}
