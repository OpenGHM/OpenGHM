"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { DetailSection } from "@/components/repository/detail-section";
import { cn } from "@/lib/utils";
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

function buildAPA(dataset: Citable): string {
  const year = new Date(dataset.about.datePublished).getUTCFullYear();
  const authors = dataset.about.creator.map((c) => formatAuthorAPA(c.name)).join(", ");
  const title = dataset.about.name;
  const publisher = "OpenGHM";
  const pub = dataset.about.relatedLink?.find((l) => l.doi);
  const doi = pub ? `https://doi.org/${pub.doi}` : "";
  return `${authors} (${year}). ${title} [Dataset]. ${publisher}.${doi ? ` ${doi}` : ""}`;
}

function buildBibTeX(dataset: Citable): string {
  const year = new Date(dataset.about.datePublished).getUTCFullYear();
  const authors = dataset.about.creator.map((c) => formatAuthorBibTeX(c.name)).join(" and ");
  const key = dataset.id.replace(/[^a-zA-Z0-9_]/g, "_");
  const pub = dataset.about.relatedLink?.find((l) => l.doi);
  const doiLine = pub ? `\n  doi       = {${pub.doi}},` : "";
  return `@dataset{${key},
  author    = {${authors}},
  title     = {${dataset.about.name}},
  year      = {${year}},
  publisher = {OpenGHM},${doiLine}
}`;
}

/** Anything with an id and a citation block: a snapshot or a model input. */
type Citable = Pick<Dataset, "id" | "about">;

export function CitationCard({ dataset }: { dataset: Citable }) {
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
    <DetailSection
      title="Citation"
      aside={
        <div className="flex gap-0.5 rounded-[11px] bg-muted p-[3px]">
          {(["apa", "bibtex"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              aria-pressed={tab === t}
              className={cn(
                "rounded-lg px-3.5 py-[7px] text-[13px] font-semibold transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                tab === t ? "bg-foreground text-white" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t === "apa" ? "APA" : "BibTeX"}
            </button>
          ))}
        </div>
      }
    >
      <div className="relative rounded-[14px] bg-hero px-[22px] pt-5 pb-14">
        <pre className="font-mono text-[13px] leading-[1.7] break-words whitespace-pre-wrap text-hero-text">
          {text}
        </pre>
        <button
          type="button"
          onClick={handleCopy}
          className="absolute right-3 bottom-3 inline-flex items-center gap-1.5 rounded-[9px] bg-white/10 px-3 py-[7px] text-[12.5px] font-semibold text-white transition-colors outline-none hover:bg-white/[0.18] focus-visible:ring-[3px] focus-visible:ring-white/40"
        >
          {copied ? (
            <>
              <Check className="size-3.5 text-hero-lit" />
              Copied
            </>
          ) : (
            <>
              <Copy className="size-3.5" />
              Copy
            </>
          )}
        </button>
      </div>
    </DetailSection>
  );
}
