import Link from "next/link";

export default function UserNotFound() {
  return (
    <div className="mx-auto max-w-6xl p-8">
      <div className="rounded-lg border border-dashed border-slate-200 bg-white p-10 text-center space-y-2">
        <p className="font-medium text-slate-900">No such user.</p>
        <Link href="/admin/users" className="text-sm text-primary hover:underline">
          Back to users
        </Link>
      </div>
    </div>
  );
}
