import Link from "next/link";
import { AdminPage, EmptyState } from "@/components/admin/admin-page";

export default function UserNotFound() {
  return (
    <AdminPage>
      <EmptyState title="No such user." className="p-10">
        They may have been removed.{" "}
        <Link href="/admin/users" className="inline-flex min-h-10 items-center text-primary hover:underline">
          Back to users
        </Link>
      </EmptyState>
    </AdminPage>
  );
}
