import { notFound } from "next/navigation";
import { InlineError } from "@/components/admin/admin-states";
import { CommunityAdminPage } from "@/components/admin/community/community-page";
import { TutorialEditor } from "@/components/admin/community/tutorial-editor";
import { fetchAdminTutorial } from "@/lib/community/admin-actions";
import { settle } from "@/lib/community/admin-load";

export default async function EditTutorialPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const loaded = settle(await fetchAdminTutorial(id), `/admin/community/tutorials/${encodeURIComponent(id)}`);
  if (!loaded.ok && loaded.status === 404) notFound();

  return (
    <CommunityAdminPage
      title={loaded.ok ? loaded.data.title : "Tutorial"}
      description={loaded.ok ? `/community/tutorials/${loaded.data.slug}` : undefined}
      breadcrumb={[
        { label: "Admin", href: "/admin" },
        { label: "Community", href: "/admin/community" },
        { label: "Tutorials", href: "/admin/community/tutorials" },
        { label: loaded.ok ? loaded.data.title : "Tutorial" },
      ]}
    >
      {loaded.ok ? (
        <TutorialEditor key={loaded.data.id} tutorial={loaded.data} />
      ) : (
        <InlineError title="Couldn't load this tutorial.">{loaded.message}</InlineError>
      )}
    </CommunityAdminPage>
  );
}
