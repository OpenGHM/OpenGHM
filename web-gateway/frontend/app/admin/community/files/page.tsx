import type { Metadata } from "next";
import { InlineError } from "@/components/admin/admin-states";
import { AdminPage } from "@/components/admin/admin-page";
import { FilesLibrary } from "@/components/admin/community/files-library";
import { fetchCommunityFiles } from "@/lib/community/admin-actions";
import { settle } from "@/lib/community/admin-load";

export const metadata: Metadata = { title: "Community files | OpenGHM Admin" };

export default async function AdminCommunityFilesPage() {
  const loaded = settle(await fetchCommunityFiles(), "/admin/community/files");

  return (
    <AdminPage title="Files" description="The media library: every image and document uploaded for the Community page.">
      {loaded.ok ? <FilesLibrary files={loaded.data} /> : <InlineError title="Couldn't load the files.">{loaded.message}</InlineError>}
    </AdminPage>
  );
}
