import Image from "next/image";
import { ArrowRight } from "lucide-react";

interface Update {
  image: string;
  tag: string;
  title: string;
  description: string;
  linkText: string;
}

const UPDATES: Update[] = [
  {
    image: "/images/update-dataset.jpg",
    tag: "New Dataset",
    title: "Amazon Basin High-Res Precipitation (2000-2023)",
    description:
      "Now available in ZARR format. Includes hourly precipitation estimates derived from IMERG satellite products.",
    linkText: "Access Data",
  },
  {
    image: "/images/update-api.jpg",
    tag: "Platform Update",
    title: "Python API v2.0 Released",
    description:
      "Major performance improvements for spatial resampling and new authentication flows for the JupyterHub gateway.",
    linkText: "Read Changelog",
  },
  {
    image: "/images/update-workshop.jpg",
    tag: "Community Event",
    title: "AGU Fall Meeting 2024 Workshop",
    description:
      "Join the OpenGHM team in San Francisco for a hands-on workshop on cloud-native hydrology.",
    linkText: "Register Now",
  },
];

export function UpdatesSection() {
  return (
    <section className="bg-white py-16 lg:py-30">
      <div className="mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-10">
        <div className="mb-8 flex flex-col items-start gap-4 border-b border-muted pb-6 sm:flex-row sm:items-end sm:justify-between lg:mb-15">
          <div>
            <span className="mb-4 block text-sm font-bold uppercase tracking-widest text-primary">
              What&apos;s New
            </span>
            <h2 className="text-3xl font-extrabold leading-tight sm:text-4xl lg:text-[42px] tracking-tight text-[#0f172a]">
              Latest Datasets &amp; News
            </h2>
          </div>
          <button className="min-h-12 w-full rounded-xl border border-muted bg-white px-6 py-3 sm:w-auto sm:px-9 sm:py-4 text-base font-semibold text-primary transition-all hover:bg-muted">
            View all updates
          </button>
        </div>

        <div className="mx-auto grid max-w-md grid-cols-1 gap-6 md:max-w-none md:grid-cols-3 lg:gap-8">
          {UPDATES.map((update) => (
            <div
              key={update.title}
              className="min-w-0 cursor-pointer overflow-hidden rounded-lg border border-muted transition-shadow hover:shadow-[0_10px_30px_rgba(0,0,0,0.08)]"
            >
              <Image
                src={update.image}
                alt={update.title}
                width={400}
                height={200}
                className="h-[200px] w-full object-cover"
              />
              <div className="p-6">
                <span className="mb-3 block text-xs font-semibold uppercase text-accent">
                  {update.tag}
                </span>
                <h3 className="mb-3 text-lg font-bold leading-snug text-[#0f172a]">
                  {update.title}
                </h3>
                <p className="mb-5 text-[15px] leading-relaxed text-slate-500">
                  {update.description}
                </p>
                <a className="inline-flex min-h-10 items-center gap-1.5 text-sm font-semibold text-primary">
                  {update.linkText}
                  <ArrowRight className="h-4 w-4" />
                </a>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
