import { InlineError } from "@/components/admin/admin-states";
import { AdminPage } from "@/components/admin/admin-page";
import { UpdatesManager } from "@/components/admin/home/updates-manager";
import { settle } from "@/lib/community/admin-load";
import { fetchHomeSettings } from "@/lib/home/admin-actions";
import { fetchHomeUpdates } from "@/lib/home/data";
import type { FeedItem } from "@/lib/home/types";

export default async function AdminLatestUpdatesPage() {
  const loaded = settle(await fetchHomeSettings(), "/admin/home/updates");
  // The preview is the public feed; a failure to read it does not stop the settings from being edited.
  let preview: FeedItem[] | null = null;
  try {
    preview = (await fetchHomeUpdates()).items;
  } catch {
    preview = null;
  }

  return (
    <AdminPage
      title="Latest updates"
      description="The “Latest Datasets & News” cards on the home page: how many, from where, and which ones stay on top."
    >
      {loaded.ok ? (
        // Keyed by the save, so what a save changed (a pin that went away) is read fresh from the backend.
        <UpdatesManager key={loaded.data.updated_at ?? "unsaved"} settings={loaded.data} preview={preview} />
      ) : (
        <InlineError title="Couldn't load the home page settings.">{loaded.message}</InlineError>
      )}
    </AdminPage>
  );
}
