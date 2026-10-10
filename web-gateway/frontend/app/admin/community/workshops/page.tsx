import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InlineError } from "@/components/admin/admin-states";
import { CommunityAdminPage } from "@/components/admin/community/community-page";
import { WorkshopList } from "@/components/admin/community/workshop-list";
import { fetchAdminWorkshops } from "@/lib/community/admin-actions";
import { settle } from "@/lib/community/admin-load";

export default async function AdminWorkshopsPage() {
  const loaded = settle(await fetchAdminWorkshops(), "/admin/community/workshops");

  return (
    <CommunityAdminPage
      title="Workshops"
      description="Announce a workshop, then add its materials once it has happened."
      actions={
        <Button asChild className="min-h-10 sm:min-h-9">
          <Link href="/admin/community/workshops/new">
            <Plus aria-hidden="true" />
            New workshop
          </Link>
        </Button>
      }
    >
      <Card>
        <CardHeader>
          <CardTitle>{loaded.ok ? `${loaded.data.length} workshops` : "Workshops"}</CardTitle>
        </CardHeader>
        <CardContent>
          {loaded.ok ? <WorkshopList workshops={loaded.data} /> : <InlineError title="Couldn't load workshops.">{loaded.message}</InlineError>}
        </CardContent>
      </Card>
    </CommunityAdminPage>
  );
}
