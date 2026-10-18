"use client";

import { CopyButton as SharedCopyButton } from "@/components/ui/copy-button";
import { cn } from "@/lib/utils";

const FOCUS = "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

/** A button that puts `text` on the clipboard and says "Copied" for a moment. `label` names what is copied, for screen readers. */
export function CopyButton({ text, label, tone }: { text: string; label: string; tone: "solid" | "quiet" }) {
  return (
    <SharedCopyButton
      text={text}
      label={label}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-[9px] font-semibold transition-colors",
        FOCUS,
        tone === "solid"
          ? "bg-primary px-3 py-2 text-[12.5px] text-primary-foreground hover:bg-primary-hover"
          : "bg-card px-2.5 py-[5px] text-xs text-primary hover:bg-secondary"
      )}
    />
  );
}

/**
 * An S3 command ready to copy: the label that says no account is needed, and
 * the command on one line that scrolls sideways, with its copy button. The
 * output dialog shows it for the whole output folder and the selection bar for
 * a selection too big to ZIP, so both look the same.
 */
export function S3Command({ command, className }: { command: string; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <span className="text-[12.5px] font-semibold">
        With any S3 tool <span className="font-normal text-muted-foreground">· no account needed</span>
      </span>
      <div className="flex items-center gap-2.5 rounded-xl border border-border bg-background py-1.5 pr-1.5 pl-3.5">
        <code className="min-w-0 flex-1 overflow-x-auto font-mono text-[13px] whitespace-nowrap [scrollbar-width:none]">
          <span aria-hidden="true" className="text-primary">
            ${" "}
          </span>
          {command}
        </code>
        <CopyButton text={command} label="S3 command" tone="solid" />
      </div>
    </div>
  );
}
