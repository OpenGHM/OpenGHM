"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Check, ChevronRight, Copy } from "lucide-react";
import { DetailSection } from "@/components/repository/detail-section";
import { ComingSoonChip, TOOLKIT_NOT_RELEASED } from "@/components/ui/coming-soon-chip";
import { OutputDialog, stepFolders, type MetadataVariable, type OutputTab } from "@/components/repository/output-dialog";
import type { OutputFolder } from "@/lib/repository/types";
import { formatBytes } from "@/lib/workspace/format";
import { cn } from "@/lib/utils";

function CopyButton({
  text,
  label,
  idle = "Copy",
  tone,
}: {
  text: string;
  /** What is copied, for a screen reader: "Copy <label>". */
  label: string;
  idle?: string;
  tone: "dark" | "dark-quiet" | "light" | "light-quiet";
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={`Copy ${label}`}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-[9px] px-3 py-2 text-[12.5px] font-semibold transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        tone === "dark" && "bg-hero-foreground text-hero hover:bg-accent",
        tone === "dark-quiet" && "text-hero-text hover:bg-white/10 hover:text-hero-foreground",
        tone === "light" && "bg-primary text-primary-foreground hover:bg-primary-hover",
        tone === "light-quiet" && "text-muted-foreground hover:bg-muted hover:text-primary",
      )}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {copied ? "Copied" : idle}
    </button>
  );
}

/** A shell command with a Copy button, on the navy panel or on a light one. */
function Command({ command, tone }: { command: string; tone: "dark" | "light" }) {
  const dark = tone === "dark";
  return (
    <div
      className={cn(
        "flex items-center gap-2.5 rounded-xl py-1.5 pr-1.5 pl-3.5",
        dark ? "border border-white/[0.12] bg-white/[0.07]" : "border border-border bg-card",
      )}
    >
      <code
        className={cn(
          "min-w-0 flex-1 overflow-x-auto font-mono text-[13px] whitespace-nowrap [scrollbar-width:none]",
          dark ? "text-hero-text" : "text-foreground",
        )}
      >
        <span aria-hidden="true" className={cn("select-none", dark ? "text-hero-lit" : "text-primary")}>
          ${" "}
        </span>
        {command}
      </code>
      <CopyButton text={command} label="command" tone={dark ? "dark" : "light"} />
    </div>
  );
}

function Tag({ children, tone }: { children: ReactNode; tone: "dark" | "light" }) {
  return (
    <span
      className={cn(
        "rounded-[7px] px-2 py-[3px] font-mono text-[11px]",
        tone === "dark" ? "bg-white/10 text-hero-text" : "bg-accent text-primary",
      )}
    >
      {children}
    </span>
  );
}

/** The navy panel that opens the section: what most people come for. */
function NavyPanel({
  eyebrow,
  title,
  tag,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  tag: string;
  description: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="relative flex flex-col gap-5 overflow-hidden rounded-[18px] bg-hero p-5 text-hero-foreground sm:p-6">
      <div aria-hidden="true" className="hero-dots pointer-events-none absolute inset-0" />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-40 -right-30 size-90 rounded-full bg-[radial-gradient(circle,color-mix(in_srgb,var(--hero-glow)_25%,transparent),transparent_65%)]"
      />
      <div className="relative flex flex-col gap-1.5">
        <span className="font-mono text-[11.5px] font-medium tracking-[0.06em] text-hero-lit uppercase">{eyebrow}</span>
        <div className="flex flex-wrap items-center gap-2.5">
          <h3 className="text-xl font-semibold tracking-[-0.02em]">{title}</h3>
          <Tag tone="dark">{tag}</Tag>
        </div>
        <p className="max-w-[560px] text-[13.5px] leading-relaxed text-pretty text-hero-subtle">{description}</p>
      </div>
      {children}
    </div>
  );
}

/** The panel's last row: the S3 address, for S3 tools, after a note. */
function PanelFooter({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex flex-wrap items-center gap-2 border-t border-white/10 pt-4">{children}</div>
  );
}

// ─── A snapshot ───────────────────────────────────────────────────────────────

/** "yearly, monthly and daily" */
function listWords(words: string[]): string {
  return words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/** One of the two doors into the output dialog, on the navy panel. */
function OutputDoor({
  title,
  tag,
  description,
  cta,
  tone,
  onClick,
}: {
  title: string;
  tag: string;
  description: string;
  cta: string;
  tone: "light" | "dark";
  onClick: () => void;
}) {
  const light = tone === "light";
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col gap-1.5 rounded-[14px] p-[18px] text-left transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        light
          ? "bg-hero-foreground text-hero hover:bg-accent"
          : "border border-white/[0.14] bg-white/[0.06] text-hero-foreground hover:bg-white/[0.11]"
      )}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="text-[15.5px] font-semibold tracking-[-0.01em]">{title}</span>
        <span
          className={cn(
            "rounded-[7px] px-2 py-[3px] font-mono text-[11px] uppercase",
            light ? "bg-secondary text-secondary-foreground" : "bg-white/10 text-hero-text"
          )}
        >
          {tag}
        </span>
      </span>
      <span className={cn("text-[13px] leading-normal text-pretty", light ? "text-muted-foreground" : "text-hero-subtle")}>
        {description}
      </span>
      <span className={cn("mt-1.5 text-[13px] font-semibold", light ? "text-primary" : "text-hero-lit")}>{cta}</span>
    </button>
  );
}

/** One thing a run needs, as a row: what it is, then how to have it. */
function Ingredient({ title, detail, mono, action }: { title: string; detail: string; mono?: boolean; action: ReactNode }) {
  return (
    <li className="flex items-center justify-between gap-3.5 border-t border-border/70 px-4 py-[13px] first:border-t-0">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[14.5px] font-semibold">{title}</span>
        <span className={cn("truncate text-[12.5px] text-muted-foreground", mono && "font-mono")}>{detail}</span>
      </div>
      {action}
    </li>
  );
}

const ROW_ACTION =
  "shrink-0 rounded-[9px] border border-border px-3 py-[7px] text-[13px] font-semibold text-foreground transition-colors outline-none hover:border-primary hover:text-primary focus-visible:ring-[3px] focus-visible:ring-ring/50";

/**
 * The "Download" section of a snapshot's page, kept small: the output (what
 * the run produced, nearly all of the bytes) behind two doors into one
 * dialog, and what it takes to run it again. `openghm snapshot fetch` gets
 * the code and init, the model input and the container, checked, and never
 * the output (packages/openghm README). metadata.json and SHA256SUMS are not
 * offered: the fetch reads them, and the files page has them.
 */
export function SnapshotDownload({
  id,
  treeUrl,
  output,
  variables,
  fetchCommand,
  containerUrl,
  containerName,
  containerSize,
  modelInputHref,
  modelInputName,
}: {
  id: string;
  treeUrl: string;
  output: OutputFolder[];
  /** The metadata's output variables, for the dialog's swatches and descriptions. */
  variables: MetadataVariable[];
  fetchCommand: string;
  containerUrl: string;
  /** `image:version`. */
  containerName: string;
  containerSize: number | null;
  modelInputHref: string;
  modelInputName: string;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<OutputTab>("subset");
  const totalBytes = output.reduce((sum, f) => sum + f.bytes, 0);
  const steps = stepFolders(output);
  const allFiles = output.reduce((sum, f) => sum + f.files, 0);
  const openOn = (next: OutputTab) => {
    setTab(next);
    setOpen(true);
  };

  return (
    <DetailSection title="Download">
      <NavyPanel
        eyebrow="Output"
        title="Simulation output"
        tag="NetCDF"
        description={
          totalBytes > 0 ? (
            <>
              What this run produced: <span className="font-mono text-hero-foreground">{formatBytes(totalBytes)}</span>
              {steps.length > 0 && <> in {listWords(steps.map((f) => f.name))} files</>}. Take just the part you need.
            </>
          ) : (
            "What this run produced, as NetCDF files. Take just the part you need."
          )
        }
      >
        <div className="relative grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-2.5">
          <OutputDoor
            tone="light"
            title="Download a subset"
            tag="1 file"
            description="One variable over the period and region you choose, as a NetCDF file cut from the output on Anvil."
            cta="Choose variable, period, region →"
            onClick={() => openOn("subset")}
          />
          <OutputDoor
            tone="dark"
            title="Output files"
            tag={allFiles > 0 ? `${allFiles.toLocaleString("en-US")} files` : "Folder"}
            description="The output as the run wrote it, whole NetCDF files by time step, or the whole folder at once."
            cta="Browse files →"
            onClick={() => openOn("files")}
          />
        </div>
      </NavyPanel>
      <OutputDialog
        snapshotId={id}
        treeUrl={treeUrl}
        output={output}
        variables={variables}
        open={open}
        onOpenChange={setOpen}
        tab={tab}
        onTabChange={setTab}
      />

      <div className="flex flex-col gap-3.5 rounded-[18px] bg-background p-5 sm:p-[22px]">
        <div className="flex flex-col gap-1">
          <h3 className="font-mono text-[11.5px] font-medium tracking-[0.06em] text-primary uppercase">
            Reproduce the run
          </h3>
          <p className="text-[13.5px] leading-relaxed text-pretty text-muted-foreground">
            The same code in the same container on the same input gives the output above again.
          </p>
        </div>
        <ul aria-label="What a run needs" className="overflow-hidden rounded-[14px] border border-border bg-card">
          <Ingredient
            title="WBM code & init"
            detail="In this snapshot"
            action={
              <Link href={`/repository/${id}/files`} className={ROW_ACTION}>
                Browse files →
              </Link>
            }
          />
          <Ingredient
            title="Model input"
            detail={modelInputName}
            action={
              <Link href={modelInputHref} aria-label={`Open model input ${modelInputName}`} className={ROW_ACTION}>
                Open →
              </Link>
            }
          />
          <Ingredient
            title="Container image"
            detail={`${containerName}${containerSize !== null ? ` · ${formatBytes(containerSize)}` : ""}`}
            mono
            action={
              <a href={containerUrl} aria-label={`Download the container image ${containerName}`} className={ROW_ACTION}>
                Download ↓
              </a>
            }
          />
        </ul>
        <div className="flex flex-col gap-2">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] font-semibold">
            All three at once with the CLI
            <ComingSoonChip title={TOOLKIT_NOT_RELEASED} />
          </span>
          <Command command={fetchCommand} tone="light" />
          <span className="text-xs leading-relaxed text-muted-foreground">
            Every file is checked as it lands. Then <code className="font-mono text-[11.5px] text-foreground/90">openghm sim run</code>{" "}
            in the fetched folder runs it.
          </span>
        </div>
      </div>
    </DetailSection>
  );
}

// ─── A model input ────────────────────────────────────────────────────────────

/**
 * The "Download" section of a model input's page: the tree is many files in
 * one folder, so the CLI fetch is the way to have it whole, and the files
 * page the way to pick from it.
 */
export function ModelInputDownload({
  id,
  treeUrl,
  fetchCommand,
}: {
  id: string;
  treeUrl: string;
  fetchCommand: string;
}) {
  return (
    <DetailSection title="Download">
      <NavyPanel
        eyebrow="Model input"
        title="Model input tree"
        tag="FOLDER"
        description="The data a run reads, as many files in one folder rather than one archive."
      >
        <div className="relative flex flex-col gap-2">
          <span className="flex items-center gap-2 text-[12.5px] font-semibold text-hero-text">
            Download with the CLI
            <ComingSoonChip title={TOOLKIT_NOT_RELEASED} tone="dark" />
          </span>
          <Command command={fetchCommand} tone="dark" />
          <span className="text-xs text-hero-faint">Every file is checked against SHA256SUMS as it lands.</span>
        </div>
        <PanelFooter>
          <span className="mr-auto text-[12.5px] text-hero-subtle">Or look through the files first</span>
          <Link
            href={`/repository/model-inputs/${id}/files`}
            className="inline-flex items-center gap-1 rounded-[9px] bg-white/10 px-3 py-2 text-[12.5px] font-semibold text-hero-foreground transition-colors outline-none hover:bg-white/[0.18] focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            Browse files
            <ChevronRight className="size-3.5" />
          </Link>
          <CopyButton text={treeUrl} label="S3 address" idle="Copy S3 address" tone="dark-quiet" />
        </PanelFooter>
      </NavyPanel>
    </DetailSection>
  );
}
