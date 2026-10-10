import { AdminPage } from "@/components/admin/admin-page";
import { NewsEditor } from "@/components/admin/home/news-editor";

export default function NewNewsPage() {
  return (
    <AdminPage
      title="New post"
      description="It stays a draft until you set it to Published."
      breadcrumb={[
        { label: "Admin", href: "/admin" },
        { label: "Home", href: "/admin/home/updates" },
        { label: "News", href: "/admin/home/news" },
        { label: "New" },
      ]}
    >
      <NewsEditor post={null} />
    </AdminPage>
  );
}
