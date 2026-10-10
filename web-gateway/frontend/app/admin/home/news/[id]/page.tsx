import { notFound } from "next/navigation";
import { InlineError } from "@/components/admin/admin-states";
import { AdminPage } from "@/components/admin/admin-page";
import { NewsEditor } from "@/components/admin/home/news-editor";
import { fetchAdminNews } from "@/lib/community/admin-actions";
import { settle } from "@/lib/community/admin-load";

export default async function EditNewsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const loaded = settle(await fetchAdminNews(id), `/admin/home/news/${encodeURIComponent(id)}`);
  if (!loaded.ok && loaded.status === 404) notFound();

  return (
    <AdminPage
      title={loaded.ok ? loaded.data.title : "News post"}
      description={loaded.ok ? `/news/${loaded.data.slug}` : undefined}
      breadcrumb={[
        { label: "Admin", href: "/admin" },
        { label: "Home", href: "/admin/home/updates" },
        { label: "News", href: "/admin/home/news" },
        { label: loaded.ok ? loaded.data.title : "News post" },
      ]}
    >
      {loaded.ok ? (
        <NewsEditor key={loaded.data.id} post={loaded.data} />
      ) : (
        <InlineError title="Couldn't load this post.">{loaded.message}</InlineError>
      )}
    </AdminPage>
  );
}
