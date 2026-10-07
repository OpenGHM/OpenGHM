"use client";

import { useState } from "react";
import { Check, Copy, Download } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Copies a file's public URL. Icon-only, for a table row; the label names the
 * file for a screen reader.
 */
export function CopyUrlButton({ url, label }: { url: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={handleCopy}
      aria-label={`Copy URL of ${label}`}
      title={copied ? "Copied" : "Copy URL"}
      className="text-muted-foreground hover:text-foreground"
    >
      {copied ? <Check className="size-4 text-emerald-500" /> : <Copy className="size-4" />}
    </Button>
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
