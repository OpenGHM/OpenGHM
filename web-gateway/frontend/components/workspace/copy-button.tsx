"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Copies `text` to the clipboard and says so in a toast. `label` names what was
 * copied ("path", "error excerpt") for the screen reader and the toast.
 */
export function CopyButton({
  text,
  label,
  className,
  disabled = false,
  tone = "muted",
}: {
  text: string;
  label: string;
  className?: string;
  disabled?: boolean;
  /** `muted`: a quiet grey button. `primary`: the filled brand button, for a
   *  copy that is the point of its box (the results path). */
  tone?: "muted" | "primary";
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success(`Copied the ${label}.`);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(`Could not copy the ${label}. Select it and copy by hand.`);
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => void copy()}
      disabled={disabled}
      aria-label={`Copy ${label}`}
      className={`min-h-10 shrink-0 gap-1.5 rounded-[9px] border-0 px-3 text-[12.5px] font-semibold shadow-none sm:min-h-8 ${
        tone === "primary"
          ? "bg-primary text-primary-foreground hover:bg-primary-hover hover:text-primary-foreground"
          : "bg-muted text-foreground hover:bg-secondary hover:text-primary"
      } ${className ?? ""}`}
    >
      {copied ? (
        <>
          <Check className={`size-3.5 ${tone === "primary" ? "" : "text-status-completed"}`} aria-hidden="true" />
          Copied
        </>
      ) : (
        <>
          <Copy className="size-3.5" aria-hidden="true" />
          Copy
        </>
      )}
    </Button>
  );
}
