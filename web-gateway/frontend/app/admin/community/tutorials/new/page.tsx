import { AdminPage } from "@/components/admin/admin-page";
import { TutorialEditor } from "@/components/admin/community/tutorial-editor";

export default function NewTutorialPage() {
  return (
    <AdminPage
      title="New tutorial"
      description="It stays hidden until you make it visible, and joins the end of the list."
      breadcrumb={[
        { label: "Admin", href: "/admin" },
        { label: "Community", href: "/admin/community" },
        { label: "Tutorials", href: "/admin/community/tutorials" },
        { label: "New" },
      ]}
    >
      <TutorialEditor tutorial={null} />
    </AdminPage>
  );
}
