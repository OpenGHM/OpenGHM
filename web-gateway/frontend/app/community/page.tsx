import type { Metadata } from "next";
import { CommunityContent, communityLayout } from "@/components/community/community-content";
import { CommunityTabs } from "@/components/community/community-tabs";
import { Footer } from "@/components/landing/footer";
import { PageBody, PageHero } from "@/components/layout/page-hero";
import { pathWithQuery } from "@/lib/auth-redirect";
import { fetchCommunityPage, withDefaults } from "@/lib/community/data";
import { DEFAULT_COMMUNITY_SETTINGS } from "@/lib/community/settings";
import { parseTab } from "@/lib/community/format";
import type { CommunityPage as CommunityData } from "@/lib/community/types";

export const metadata: Metadata = {
  title: "Community | OpenGHM",
  description:
    "Workshops, tutorials and publications from the OpenGHM project, and groups where researchers discuss the snapshots they run.",
};

export default async function CommunityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;

  // Open to anyone. When the backend does not answer the page still opens, on
  // the default heading, with an error box where the content would be.
  let data: CommunityData;
  let failed = false;
  try {
    data = await fetchCommunityPage();
  } catch {
    data = withDefaults(null);
    failed = true;
  }
  const { settings } = data;

  const tab = parseTab(params.tab, settings.show_groups);
  const here = pathWithQuery("/community", params);
  const overlap = communityLayout(data, tab, failed).startsWithCard;

  return (
    <div className="flex min-h-screen flex-col">
      <PageHero
        size="page"
        eyebrow="Community"
        title={settings.hero_title || DEFAULT_COMMUNITY_SETTINGS.hero_title}
        subtitle={settings.hero_intro || undefined}
        overlap={overlap}
      >
        <CommunityTabs active={tab} showGroups={settings.show_groups} />
      </PageHero>
      <PageBody overlap={overlap} className="flex flex-1 flex-col gap-16">
        <CommunityContent page={data} tab={tab} failed={failed} here={here} />
      </PageBody>
      <Footer />
    </div>
  );
}
