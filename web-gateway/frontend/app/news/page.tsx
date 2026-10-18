import type { Metadata } from "next";
import { UpdateCard } from "@/components/landing/update-card";
import { Footer } from "@/components/landing/footer";
import { PageBody, PageHero } from "@/components/layout/page-hero";
import { fetchAllUpdates } from "@/lib/home/data";
import type { FeedItem } from "@/lib/home/types";

export const metadata: Metadata = {
  title: "News | OpenGHM",
  description: "New datasets, announcements and community events from the OpenGHM project.",
};

/** Everything the home page's "Latest Snapshots & News" draws on, newest first. Open to anyone. */
export default async function NewsPage() {
  let items: FeedItem[] = [];
  let failed = false;
  try {
    items = (await fetchAllUpdates()).items;
  } catch {
    failed = true;
  }

  return (
    <div className="flex min-h-screen flex-col">
      <PageHero
        size="page"
        breadcrumb={[{ label: "Home", href: "/" }, { label: "News" }]}
        eyebrow="What's New"
        title="All updates"
        subtitle="New datasets, announcements and community events, newest first."
      />
      <PageBody className="flex-1">
        {failed ? (
          <div
            role="alert"
            className="space-y-2 rounded-card border border-destructive/25 bg-card p-8 text-center shadow-card"
          >
            <p className="font-medium text-status-failed">The updates could not be loaded.</p>
            <p className="text-sm text-destructive">
              The gateway could not reach its content service. Try again in a moment.
            </p>
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-card border border-dashed border-border bg-card px-6 py-12 text-center text-[15px] text-muted-foreground shadow-raised">
            Nothing has been posted yet.
          </div>
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(300px,100%),1fr))] gap-3.5">
            {items.map((item) => (
              <li key={`${item.kind}:${item.id}`} className="grid">
                <div className="w-full">
                  <UpdateCard item={item} showDate />
                </div>
              </li>
            ))}
          </ul>
        )}
      </PageBody>
      <Footer />
    </div>
  );
}
