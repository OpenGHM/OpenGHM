import { notFound } from "next/navigation";
import { InlineError } from "@/components/admin/admin-states";
import { AdminPage } from "@/components/admin/admin-page";
import { WorkshopEditor } from "@/components/admin/community/workshop-editor";
import { fetchAdminWorkshop } from "@/lib/community/admin-actions";
import { settle } from "@/lib/community/admin-load";

export default async function EditWorkshopPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const loaded = settle(await fetchAdminWorkshop(id), `/admin/community/workshops/${encodeURIComponent(id)}`);
  if (!loaded.ok && loaded.status === 404) notFound();

  const breadcrumb = [
    { label: "Admin", href: "/admin" },
    { label: "Community", href: "/admin/community" },
    { label: "Workshops", href: "/admin/community/workshops" },
    { label: loaded.ok ? loaded.data.title : "Workshop" },
  ];

  return (
    <AdminPage
      title={loaded.ok ? loaded.data.title : "Workshop"}
      description={loaded.ok ? `/community/workshops/${loaded.data.slug}` : undefined}
      breadcrumb={breadcrumb}
    >
      {loaded.ok ? (
        // Keyed by id: a refresh after a save must not remount the editor under the cursor.
        <WorkshopEditor key={loaded.data.id} workshop={loaded.data} />
      ) : (
        <InlineError title="Couldn't load this workshop.">{loaded.message}</InlineError>
      )}
    </AdminPage>
  );
}
