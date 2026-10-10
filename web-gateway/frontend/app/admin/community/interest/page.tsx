import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InlineError } from "@/components/admin/admin-states";
import { CommunityAdminPage } from "@/components/admin/community/community-page";
import { InterestTable } from "@/components/admin/community/interest-table";
import { fetchGroupInterest } from "@/lib/community/admin-actions";
import { settle } from "@/lib/community/admin-load";

export default async function AdminGroupInterestPage() {
  const loaded = settle(await fetchGroupInterest(), "/admin/community/interest");

  return (
    <CommunityAdminPage title="Group interest" description="People who asked to be told when discussion groups open.">
      <Card>
        <CardHeader>
          <CardTitle>Interested people</CardTitle>
        </CardHeader>
        <CardContent>
          {loaded.ok ? <InterestTable entries={loaded.data} /> : <InlineError title="Couldn't load the list.">{loaded.message}</InlineError>}
        </CardContent>
      </Card>
    </CommunityAdminPage>
  );
}
