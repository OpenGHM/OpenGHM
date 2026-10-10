import { InlineError } from "@/components/admin/admin-states";
import { CommunityAdminPage } from "@/components/admin/community/community-page";
import { FilesLibrary } from "@/components/admin/community/files-library";
import { fetchCommunityFiles } from "@/lib/community/admin-actions";
import { settle } from "@/lib/community/admin-load";

export default async function AdminCommunityFilesPage() {
  const loaded = settle(await fetchCommunityFiles(), "/admin/community/files");

  return (
    <CommunityAdminPage title="Files" description="The media library: every image and document uploaded for the Community page.">
      {loaded.ok ? <FilesLibrary files={loaded.data} /> : <InlineError title="Couldn't load the files.">{loaded.message}</InlineError>}
    </CommunityAdminPage>
  );
}
