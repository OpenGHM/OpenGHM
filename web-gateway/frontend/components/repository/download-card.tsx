"use client";

import { useState } from "react";
import Link from "next/link";
import { Copy, Check, FolderTree } from "lucide-react";
import { DetailSection } from "@/components/repository/detail-section";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface DownloadItem {
  label: string;
  url: string;
  /** Single files are clickable; a tree prefix is many files, so it is copy-only. */
  isFile: boolean;
}

function CopyButton({ text, label, tone = "muted" }: { text: string; label: string; tone?: "muted" | "primary" }) {
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
        "inline-flex shrink-0 items-center gap-1.5 rounded-[9px] px-3 py-[7px] text-[12.5px] font-semibold transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        tone === "primary"
          ? "bg-primary text-primary-foreground hover:bg-primary-hover"
          : "bg-muted text-foreground hover:bg-secondary",
      )}
    >
      {copied ? (
        <>
          <Check className="size-3.5" />
          Copied
        </>
      ) : (
        <>
          <Copy className="size-3.5" />
          Copy
        </>
      )}
    </button>
  );
}

/**
 * The "Download" section of a snapshot or model-input detail page. The
 * links are plain public HTTPS strings from the backend's `/links` routes;
 * the browser downloads from Anvil S3 directly. `command`, when given, is the
 * CLI fetch. `browseHref`, when given, is the files page that walks the tree.
 */
export function DownloadCard({
  items,
  command,
  browseHref,
}: {
  items: DownloadItem[];
  command?: string;
  browseHref?: string;
}) {
  return (
    <DetailSection title="Download">
      <p className="-mt-2.5 text-sm leading-relaxed text-pretty text-muted-foreground">
        {command
          ? "The tree is many files, not one archive. The CLI fetches it and verifies every file against SHA256SUMS."
          : "The tree is many files, not one archive. Verify a downloaded copy with sha256sum -c SHA256SUMS."}
      </p>
      {browseHref && (
        <Button variant="outline" size="sm" asChild className="self-start">
          <Link href={browseHref}>
            <FolderTree className="size-4" />
            Browse files
          </Link>
        </Button>
      )}
      {command && (
        <div className="flex flex-col gap-1.5 rounded-[14px] bg-secondary p-4">
          <span className="text-xs font-semibold text-primary-hover">CLI</span>
          <div className="flex items-center gap-2.5">
            <code className="min-w-0 flex-1 overflow-x-auto font-mono text-[13px] whitespace-nowrap text-hero [scrollbar-width:thin]">
              <span aria-hidden="true" className="select-none">
                ${" "}
              </span>
              {command}
            </code>
            <CopyButton text={command} label="command" tone="primary" />
          </div>
        </div>
      )}
      <dl className="flex flex-col overflow-hidden rounded-[14px] border border-border/70">
        {items.map((item) => (
          <div key={item.label} className="flex flex-col gap-[3px] border-t border-border/60 px-4 py-[13px] first:border-t-0">
            <dt className="text-[13px] font-semibold text-foreground/90">{item.label}</dt>
            <dd className="flex items-center gap-3.5">
              {item.isFile ? (
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={item.url}
                  className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground transition-colors hover:text-primary hover:underline"
                >
                  {item.url}
                </a>
              ) : (
                <code title={item.url} className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
                  {item.url}
                </code>
              )}
              <CopyButton text={item.url} label={item.label} />
            </dd>
          </div>
        ))}
      </dl>
    </DetailSection>
  );
}
