import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InlineError } from "@/components/admin/admin-states";
import { AdminPage } from "@/components/admin/admin-page";
import { WorkshopList } from "@/components/admin/community/workshop-list";
import { fetchAdminWorkshops } from "@/lib/community/admin-actions";
import { settle } from "@/lib/community/admin-load";
import { countLabel } from "@/lib/community/format";
import { fetchHomeSettings } from "@/lib/home/admin-actions";

export default async function AdminWorkshopsPage() {
  const loaded = settle(await fetchAdminWorkshops(), "/admin/community/workshops");
  // Which workshops are pinned to the home page; without it the rows simply have no pin button.
  const settings = await fetchHomeSettings();
  const pinned = settings.ok ? settings.data.pins.filter((p) => p.kind === "workshop").map((p) => p.id) : null;

  return (
    <AdminPage
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
          <CardTitle>{loaded.ok ? countLabel(loaded.data.length, "workshop") : "Workshops"}</CardTitle>
        </CardHeader>
        <CardContent>
          {loaded.ok ? <WorkshopList workshops={loaded.data} pinned={pinned} /> : <InlineError title="Couldn't load workshops.">{loaded.message}</InlineError>}
        </CardContent>
      </Card>
    </AdminPage>
  );
}
