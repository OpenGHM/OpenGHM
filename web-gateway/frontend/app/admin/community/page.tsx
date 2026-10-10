import { InlineError } from "@/components/admin/admin-states";
import { CommunityAdminPage } from "@/components/admin/community/community-page";
import { CommunityOverview, type SectionFigures } from "@/components/admin/community/community-overview";
import {
  fetchAdminPublications,
  fetchAdminTutorials,
  fetchAdminWorkshops,
  fetchCommunityFiles,
} from "@/lib/community/admin-actions";
import { settle, type Loaded } from "@/lib/community/admin-load";

const HERE = "/admin/community";

/** How many items a section holds and how many are drafts; null for a section that could not be read. */
function figures(result: Loaded<{ state: string }[]>): SectionFigures {
  return result.ok
    ? { total: result.data.length, drafts: result.data.filter((item) => item.state === "draft").length }
    : { total: null, drafts: null };
}

export default async function CommunityAdminOverviewPage() {
  const [workshops, tutorials, publications, files] = await Promise.all([
    fetchAdminWorkshops(),
    fetchAdminTutorials(),
    fetchAdminPublications(),
    fetchCommunityFiles(),
  ]);
  const loaded = {
    workshops: settle(workshops, HERE),
    tutorials: settle(tutorials, HERE),
    publications: settle(publications, HERE),
    files: settle(files, HERE),
  };
  const failed = Object.values(loaded).some((r) => !r.ok);

  return (
    <CommunityAdminPage title="Community" description="Everything on the Community page is written here.">
      {failed && (
        <InlineError title="Some counts could not be loaded.">They show a dash for now. Reload the page to try again.</InlineError>
      )}
      <CommunityOverview
        workshops={figures(loaded.workshops)}
        tutorials={figures(loaded.tutorials)}
        publications={figures(loaded.publications)}
        files={loaded.files.ok ? loaded.files.data.length : null}
      />
    </CommunityAdminPage>
  );
}
