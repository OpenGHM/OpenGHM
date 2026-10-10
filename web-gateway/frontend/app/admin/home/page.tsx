import { redirect } from "next/navigation";

/** The Home group has no overview of its own: it opens on its first page. */
export default function AdminHomePage() {
  redirect("/admin/home/updates");
}
