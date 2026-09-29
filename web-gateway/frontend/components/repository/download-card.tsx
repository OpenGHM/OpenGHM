"use client";

import { useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, Copy, Check } from "lucide-react";

export interface DownloadItem {
  label: string;
  url: string;
  /** Single files are clickable; a tree prefix is many files, so it is copy-only. */
  isFile: boolean;
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleCopy}
      aria-label={`Copy ${label}`}
      className="h-7 shrink-0 gap-1.5 px-3 text-xs text-muted-foreground hover:text-foreground"
    >
      {copied ? (
        <>
          <Check className="size-3.5 text-emerald-500" />
          Copied
        </>
      ) : (
        <>
          <Copy className="size-3.5" />
          Copy
        </>
      )}
    </Button>
  );
}

/**
 * The "Download" section of a snapshot or model-input detail page. The
 * links are plain public HTTPS strings from the backend's `/links` routes;
 * the browser downloads from Anvil S3 directly. `command`, when given, is the
 * CLI fetch.
 */
export function DownloadCard({
  items,
  command,
}: {
  items: DownloadItem[];
  command?: string;
}) {
  return (
    <Card className="overflow-hidden rounded-xl border-0 gap-0 py-0 shadow-sm">
      <CardHeader className="border-b bg-gradient-to-r from-cyan-500/5 to-transparent !py-4 !gap-0 grid-rows-1 items-center">
        <CardTitle className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <div className="flex size-8 items-center justify-center rounded-lg bg-cyan-500/10">
            <Download className="size-4 text-cyan-600" />
          </div>
          Download
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-5 pb-6 space-y-4">
        <p className="text-sm text-muted-foreground">
          {command
            ? "The tree is many files, not one archive. The CLI fetches it and verifies every file against SHA256SUMS."
            : "The tree is many files, not one archive. Verify a downloaded copy with sha256sum -c SHA256SUMS."}
        </p>
        {command && (
          <div className="space-y-1.5">
            <div className="text-xs font-medium uppercase tracking-wider text-slate-400">CLI</div>
            <div className="flex items-center gap-3 rounded-lg bg-slate-50 p-3">
              <code className="min-w-0 flex-1 break-all font-mono text-xs text-slate-700">{command}</code>
              <CopyButton text={command} label="command" />
            </div>
          </div>
        )}
        <dl className="space-y-3">
          {items.map((item) => (
            <div key={item.label} className="space-y-1.5">
              <dt className="text-xs font-medium uppercase tracking-wider text-slate-400">{item.label}</dt>
              <dd className="flex items-center gap-3 rounded-lg bg-slate-50 p-3">
                {item.isFile ? (
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-w-0 flex-1 break-all font-mono text-xs text-[#006994] hover:underline"
                  >
                    {item.url}
                  </a>
                ) : (
                  <code className="min-w-0 flex-1 break-all font-mono text-xs text-slate-700">{item.url}</code>
                )}
                <CopyButton text={item.url} label={item.label} />
              </dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
