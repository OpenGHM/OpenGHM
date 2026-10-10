import { InlineError } from "@/components/admin/admin-states";
import { CommunityAdminPage } from "@/components/admin/community/community-page";
import { SettingsForm } from "@/components/admin/community/settings-form";
import { fetchAdminSettings } from "@/lib/community/admin-actions";
import { settle } from "@/lib/community/admin-load";

export default async function AdminCommunitySettingsPage() {
  const loaded = settle(await fetchAdminSettings(), "/admin/community/settings");

  return (
    <CommunityAdminPage title="Page settings" description="The heading of the Community page and its Discussion groups section.">
      {loaded.ok ? (
        <SettingsForm settings={loaded.data} />
      ) : (
        <InlineError title="Couldn't load the page settings.">{loaded.message}</InlineError>
      )}
    </CommunityAdminPage>
  );
}
