import type { Metadata } from "next";
import { AdminPage } from "@/components/admin/admin-page";
import { WorkshopEditor } from "@/components/admin/community/workshop-editor";

export const metadata: Metadata = { title: "New workshop | OpenGHM Admin" };

export default function NewWorkshopPage() {
  return (
    <AdminPage
      title="New workshop"
      description="It stays hidden until you make it visible."
      breadcrumb={[
        { label: "Admin", href: "/admin" },
        { label: "Community", href: "/admin/community" },
        { label: "Workshops", href: "/admin/community/workshops" },
        { label: "New" },
      ]}
    >
      <WorkshopEditor workshop={null} />
    </AdminPage>
  );
}
