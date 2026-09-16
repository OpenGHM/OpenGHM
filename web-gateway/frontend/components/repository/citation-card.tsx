"use client";

import { useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Quote, Copy, Check } from "lucide-react";
import { Dataset } from "@/lib/repository/types";

function formatAuthorAPA(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name;
  const last = parts[parts.length - 1];
  const initials = parts
    .slice(0, -1)
    .map((p) => p[0].toUpperCase() + ".")
    .join(" ");
  return `${last}, ${initials}`;
}

function formatAuthorBibTeX(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name;
  const last = parts[parts.length - 1];
  const first = parts.slice(0, -1).join(" ");
  return `${last}, ${first}`;
}

function buildAPA(dataset: Dataset): string {
  const year = new Date(dataset.lastUpdated).getFullYear();
  const authors = dataset.creators.map((c) => formatAuthorAPA(c.name)).join(", ");
  const title = dataset.title;
  const publisher = "OpenGHM";
  const pub = dataset.relatedLinks.find((l) => l.doi);
  const doi = pub ? `https://doi.org/${pub.doi}` : "";
  return `${authors} (${year}). ${title} [Dataset]. ${publisher}.${doi ? ` ${doi}` : ""}`;
}

function buildBibTeX(dataset: Dataset): string {
  const year = new Date(dataset.lastUpdated).getFullYear();
  const authors = dataset.creators.map((c) => formatAuthorBibTeX(c.name)).join(" and ");
  const key = dataset.id.replace(/[^a-zA-Z0-9_]/g, "_");
  const pub = dataset.relatedLinks.find((l) => l.doi);
  const doiLine = pub ? `\n  doi       = {${pub.doi}},` : "";
  return `@dataset{${key},
  author    = {${authors}},
  title     = {${dataset.title}},
  year      = {${year}},
  publisher = {OpenGHM},${doiLine}
}`;
}

export function CitationCard({ dataset }: { dataset: Dataset }) {
  const [tab, setTab] = useState<"apa" | "bibtex">("apa");
  const [copied, setCopied] = useState(false);

  const apa = buildAPA(dataset);
  const bibtex = buildBibTeX(dataset);
  const text = tab === "apa" ? apa : bibtex;

  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <Card className="overflow-hidden rounded-xl border-0 gap-0 py-0 shadow-sm">
      <CardHeader className="border-b bg-gradient-to-r from-indigo-500/5 to-transparent !py-4 !gap-0 grid-rows-1 items-center">
        <CardTitle className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <div className="flex size-8 items-center justify-center rounded-lg bg-indigo-500/10">
            <Quote className="size-4 text-indigo-600" />
          </div>
          Citation
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-5 pb-6">
        <div className="mb-3 flex gap-1 rounded-lg bg-muted p-1">
          {(["apa", "bibtex"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                tab === t
                  ? "bg-white text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t === "apa" ? "APA" : "BibTeX"}
            </button>
          ))}
        </div>
        <div className="space-y-2">
          <pre className="rounded-lg bg-slate-50 p-4 text-xs leading-relaxed text-slate-700 whitespace-pre-wrap break-words font-mono">
            {text}
          </pre>
          <div className="flex justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopy}
              className="h-7 gap-1.5 px-3 text-xs text-muted-foreground hover:text-foreground"
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
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
