import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InlineError } from "@/components/admin/admin-states";
import { CommunityAdminPage } from "@/components/admin/community/community-page";
import { TutorialList } from "@/components/admin/community/tutorial-list";
import { fetchAdminTutorials } from "@/lib/community/admin-actions";
import { settle } from "@/lib/community/admin-load";

export default async function AdminTutorialsPage() {
  const loaded = settle(await fetchAdminTutorials(), "/admin/community/tutorials");

  return (
    <CommunityAdminPage
      title="Tutorials"
      description="The cards in the Tutorials section, in the order shown on the page."
      actions={
        <Button asChild className="min-h-10 sm:min-h-9">
          <Link href="/admin/community/tutorials/new">
            <Plus aria-hidden="true" />
            New tutorial
          </Link>
        </Button>
      }
    >
      <Card>
        <CardHeader>
          <CardTitle>{loaded.ok ? `${loaded.data.length} tutorials` : "Tutorials"}</CardTitle>
        </CardHeader>
        <CardContent>
          {loaded.ok ? <TutorialList tutorials={loaded.data} /> : <InlineError title="Couldn't load tutorials.">{loaded.message}</InlineError>}
        </CardContent>
      </Card>
    </CommunityAdminPage>
  );
}
