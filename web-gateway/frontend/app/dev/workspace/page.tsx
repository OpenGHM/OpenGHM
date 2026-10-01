import { notFound, redirect } from "next/navigation";
import { PREVIEW_GROUPS } from "@/lib/workspace/preview";

/** The design preview's first state. Dev only: a 404 in production. */
export default function DevWorkspaceIndexPage() {
  if (process.env.NODE_ENV === "production") notFound();
  redirect(`/dev/workspace/${encodeURIComponent(PREVIEW_GROUPS[0].options[0].key)}`);
}
