"use client";

import { useState, useSyncExternalStore } from "react";
import { DetailSection } from "@/components/repository/detail-section";
import { CopyButton } from "@/components/ui/copy-button";
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

/**
 * The snapshot's own address, which is what identifies it: the citation ends
 * with it. Related publications are not it, so their DOI stays out of the
 * citation (`primaryPublication` offers it on a line of its own).
 */
function buildAPA(dataset: Citable, url: string): string {
  const year = new Date(dataset.about.datePublished).getUTCFullYear();
  const authors = dataset.about.creator.map((c) => formatAuthorAPA(c.name)).join(", ");
  const title = dataset.about.name;
  const publisher = "OpenGHM";
  const tail = `${publisher}.${url ? ` ${url}` : ""}`;
  // No author: APA starts with the title, and the year follows it.
  return authors
    ? `${authors} (${year}). ${title} [Dataset]. ${tail}`
    : `${title} [Dataset]. (${year}). ${tail}`;
}

function buildBibTeX(dataset: Citable, url: string): string {
  const year = new Date(dataset.about.datePublished).getUTCFullYear();
  const authors = dataset.about.creator.map((c) => formatAuthorBibTeX(c.name)).join(" and ");
  const key = dataset.id.replace(/[^a-zA-Z0-9_]/g, "_");
  const fields = [
    authors && `  author    = {${authors}}`,
    `  title     = {${dataset.about.name}}`,
    `  year      = {${year}}`,
    `  publisher = {OpenGHM}`,
    url && `  url       = {${url}}`,
  ].filter(Boolean);
  return `@dataset{${key},\n${fields.join(",\n")},\n}`;
}

/** The DOI of the first related publication that has one: the paper to cite besides the data. */
function primaryPublication(dataset: Citable): string | null {
  return dataset.about.relatedLink?.find((l) => l.doi)?.doi ?? null;
}

// The page's own origin is only known in the browser; the server render and
// the hydration pass leave the address out, then the real one fills in.
const noSubscription = () => () => {};
const useOrigin = () =>
  useSyncExternalStore(
    noSubscription,
    () => window.location.origin,
    () => ""
  );

/** Anything with an id and a citation block: a snapshot or a model input. */
type Citable = Pick<Dataset, "id" | "about">;

/** `path` is the page of the item on this site ("/repository/<id>"): its address ends the citation. */
export function CitationCard({ dataset, path }: { dataset: Citable; path: string }) {
  const [tab, setTab] = useState<"apa" | "bibtex">("apa");
  const origin = useOrigin();
  const url = origin ? `${origin}${path}` : "";

  const text = tab === "apa" ? buildAPA(dataset, url) : buildBibTeX(dataset, url);
  const doi = primaryPublication(dataset);

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
        <CopyButton
          text={text}
          label={tab === "apa" ? "APA citation" : "BibTeX citation"}
          copiedIconClassName="text-hero-lit"
          className="absolute right-3 bottom-3 inline-flex items-center gap-1.5 rounded-[9px] bg-white/10 px-3 py-[7px] text-[12.5px] font-semibold text-white transition-colors outline-none hover:bg-white/[0.18] focus-visible:ring-[3px] focus-visible:ring-white/40"
        />
      </div>
      {doi && (
        <p className="text-[13px] text-muted-foreground">
          Please also cite the primary publication:{" "}
          <a
            href={`https://doi.org/${doi}`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-primary underline-offset-2 hover:underline"
          >
            doi:{doi}
          </a>
        </p>
      )}
    </DetailSection>
  );
}
