"use client";

import { Download } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { cn } from "@/lib/utils";

/**
 * Copies a file's public URL. Icon-only, for a table row; the label names the
 * file for a screen reader.
 */
export function CopyUrlButton({ url, label }: { url: string; label: string }) {
  return (
    <CopyButton
      text={url}
      label={`URL of ${label}`}
      iconOnly
      idleTitle="Copy URL"
      iconClassName="size-4"
      copiedIconClassName="text-success"
      className={cn(
        buttonVariants({ variant: "ghost", size: "icon-sm" }),
        "text-muted-foreground hover:text-foreground"
      )}
    />
  );
}

/**
 * The download link of a file: its public S3 URL, which the browser follows
 * itself (the bucket sends no CORS headers, so the page never reads it). A new
 * tab, so a text file the browser would show does not take the page away.
 */
export function DownloadLink({ url, label }: { url: string; label: string }) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      asChild
      className="text-muted-foreground hover:text-foreground"
    >
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Download ${label}`}
        title="Download"
      >
        <Download className="size-4" />
      </a>
    </Button>
  );
}
