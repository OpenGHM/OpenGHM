import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fetchHomeUpdates } from "@/lib/home/data";
import type { HomeUpdates } from "@/lib/home/types";
import { SectionEyebrow, SectionTitle } from "./section-parts";
import { UpdateCard } from "./update-card";

/**
 * "Latest Datasets & News": the cards an admin configured in the console
 * (`/admin/home/updates`): pinned items first, then the newest posts,
 * workshops and datasets. Nothing here is hard-coded, so when there is
 * nothing to show, or the backend does not answer, the section is left out
 * and the rest of the home page renders as usual.
 */
export async function UpdatesSection() {
  let feed: HomeUpdates;
  try {
    feed = await fetchHomeUpdates();
  } catch {
    return null;
  }
  if (feed.items.length === 0) return null;

  return (
    <section className="flex flex-col gap-9">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="flex flex-col gap-3.5">
          <SectionEyebrow>{feed.settings.eyebrow}</SectionEyebrow>
          <SectionTitle>{feed.settings.title}</SectionTitle>
        </div>
        <Button
          asChild
          variant="outline"
          className="h-auto rounded-[11px] px-4 py-[11px] font-semibold shadow-none hover:border-primary hover:bg-card hover:text-primary"
        >
          <Link href="/news">
            View all updates
            <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))] gap-3.5">
        {feed.items.map((item) => (
          <UpdateCard key={`${item.kind}:${item.id}`} item={item} />
        ))}
      </div>
    </section>
  );
}
