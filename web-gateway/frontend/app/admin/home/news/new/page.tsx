import type { Metadata } from "next";
import { AdminPage } from "@/components/admin/admin-page";
import { NewsEditor } from "@/components/admin/home/news-editor";

export const metadata: Metadata = { title: "New news post | OpenGHM Admin" };

export default function NewNewsPage() {
  return (
    <AdminPage
      title="New post"
      description="It stays hidden until you make it visible."
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
