import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InlineError } from "@/components/admin/admin-states";
import { AdminPage } from "@/components/admin/admin-page";
import { PublicationManager } from "@/components/admin/community/publication-manager";
import { fetchAdminPublications } from "@/lib/community/admin-actions";
import { settle } from "@/lib/community/admin-load";
import { countLabel } from "@/lib/community/format";

export const metadata: Metadata = { title: "Publications | OpenGHM Admin" };

export default async function AdminPublicationsPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string | string[] }>;
}) {
  const startNew = (await searchParams).new === "1";
  const loaded = settle(await fetchAdminPublications(), "/admin/community/publications");

  return (
    <AdminPage
      title="Publications"
      description="Papers, datasets, software and talks, newest year first."
      actions={
        <Button asChild className="min-h-10 sm:min-h-9">
          <Link href="/admin/community/publications?new=1" scroll={false}>
            <Plus aria-hidden="true" />
            New publication
          </Link>
        </Button>
      }
    >
      <Card>
        <CardHeader>
          <CardTitle>{loaded.ok ? countLabel(loaded.data.length, "publication") : "Publications"}</CardTitle>
        </CardHeader>
        <CardContent>
          {loaded.ok ? (
            // Keyed on `?new=1`, so following the New link opens the sheet even
            // while the list is already on screen.
            <PublicationManager key={startNew ? "new" : "list"} publications={loaded.data} startNew={startNew} />
          ) : (
            <InlineError title="Couldn't load publications.">{loaded.message}</InlineError>
          )}
        </CardContent>
      </Card>
    </AdminPage>
  );
}
