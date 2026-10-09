import Image from "next/image";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SectionEyebrow, SectionTitle } from "./section-parts";

interface Update {
  image: string;
  tag: string;
  /** Background and text colour of the tag pill. */
  tagClassName: string;
  title: string;
  description: string;
  linkText: string;
}

const UPDATES: Update[] = [
  {
    image: "/images/update-dataset.jpg",
    tag: "New Dataset",
    tagClassName: "bg-secondary text-secondary-foreground",
    title: "Amazon Basin High-Res Precipitation (2000-2023)",
    description:
      "Now available in ZARR format. Includes hourly precipitation estimates derived from IMERG satellite products.",
    linkText: "Access Data",
  },
  {
    image: "/images/update-api.jpg",
    tag: "Platform Update",
    tagClassName: "bg-compute/10 text-compute",
    title: "Python API v2.0 Released",
    description:
      "Major performance improvements for spatial resampling and new authentication flows for the JupyterHub gateway.",
    linkText: "Read Changelog",
  },
  {
    image: "/images/update-workshop.jpg",
    tag: "Community Event",
    tagClassName: "bg-success/10 text-success",
    title: "AGU Fall Meeting 2024 Workshop",
    description:
      "Join the OpenGHM team in San Francisco for a hands-on workshop on cloud-native hydrology.",
    linkText: "Register Now",
  },
];

export function UpdatesSection() {
  return (
    <section className="flex flex-col gap-9">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="flex flex-col gap-3.5">
          <SectionEyebrow>What&apos;s New</SectionEyebrow>
          <SectionTitle>Latest Datasets &amp; News</SectionTitle>
        </div>
        <Button
          variant="outline"
          className="h-auto rounded-[11px] px-4 py-[11px] font-semibold shadow-none hover:border-primary hover:bg-card hover:text-primary"
        >
          View all updates
          <ArrowRight aria-hidden="true" />
        </Button>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))] gap-3.5">
        {UPDATES.map((update) => (
          <article
            key={update.title}
            className="flex min-w-0 flex-col rounded-card bg-card p-2 transition-[transform,box-shadow] duration-200 hover:shadow-lift motion-safe:hover:-translate-y-[3px]"
          >
            <div className="relative aspect-[16/10] overflow-hidden rounded-2xl bg-accent">
              <Image
                src={update.image}
                alt={update.title}
                fill
                sizes="(min-width: 1360px) 440px, (min-width: 768px) 33vw, 100vw"
                className="object-cover"
              />
            </div>
            <div className="flex flex-1 flex-col gap-2.5 px-3.5 pt-[18px] pb-3">
              <span
                className={`self-start rounded-full px-2.5 py-1 text-xs font-semibold ${update.tagClassName}`}
              >
                {update.tag}
              </span>
              <h3 className="text-lg leading-[1.3] font-[650] tracking-[-0.02em] text-pretty">
                {update.title}
              </h3>
              <p className="text-sm leading-[1.6] text-pretty text-muted-foreground">
                {update.description}
              </p>
              <span className="mt-auto inline-flex items-center gap-1.5 pt-2 text-sm font-semibold text-primary">
                {update.linkText}
                <ArrowRight aria-hidden="true" className="size-4" />
              </span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
