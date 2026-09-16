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
    <section className="bg-white py-30">
      <div className="mx-auto max-w-[1280px] px-10">
        <div className="mb-15 flex items-end justify-between border-b border-muted pb-6">
          <div>
            <span className="mb-4 block text-sm font-bold uppercase tracking-widest text-primary">
              What&apos;s New
            </span>
            <h2 className="text-[42px] font-extrabold leading-tight tracking-tight text-[#0f172a]">
              Latest Datasets &amp; News
            </h2>
          </div>
          <button className="rounded-xl border border-muted bg-white px-9 py-4 text-base font-semibold text-primary transition-all hover:bg-muted">
            View all updates
          </button>
        </div>

        <div className="grid grid-cols-3 gap-8">
          {UPDATES.map((update) => (
            <div
              key={update.title}
              className="cursor-pointer overflow-hidden rounded-lg border border-muted transition-shadow hover:shadow-[0_10px_30px_rgba(0,0,0,0.08)]"
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
                <a className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary">
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
