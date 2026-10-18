import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InlineError } from "@/components/admin/admin-states";
import { AdminPage } from "@/components/admin/admin-page";
import { NewsList } from "@/components/admin/home/news-list";
import { fetchAdminNewsList } from "@/lib/community/admin-actions";
import { settle } from "@/lib/community/admin-load";
import { countLabel } from "@/lib/community/format";
import { fetchHomeSettings } from "@/lib/home/admin-actions";

export const metadata: Metadata = { title: "News | OpenGHM Admin" };

export default async function AdminNewsPage() {
  const loaded = settle(await fetchAdminNewsList(), "/admin/home/news");
  // Which posts are pinned; without it the rows simply have no pin button.
  const settings = await fetchHomeSettings();
  const pinned = settings.ok ? settings.data.pins.filter((p) => p.kind === "news").map((p) => p.id) : null;

  return (
    <AdminPage
      title="News"
      description="Posts for the home page and the news page. Which ones the home page shows is set under Latest updates."
      actions={
        <Button asChild className="min-h-10 sm:min-h-9">
          <Link href="/admin/home/news/new">
            <Plus aria-hidden="true" />
            New post
          </Link>
        </Button>
      }
    >
      <Card>
        <CardHeader>
          <CardTitle>{loaded.ok ? countLabel(loaded.data.length, "post") : "Posts"}</CardTitle>
        </CardHeader>
        <CardContent>
          {loaded.ok ? <NewsList posts={loaded.data} pinned={pinned} /> : <InlineError title="Couldn't load the news posts.">{loaded.message}</InlineError>}
        </CardContent>
      </Card>
    </AdminPage>
  );
}
