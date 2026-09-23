import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { Header } from "@/components/landing/header";
import { Footer } from "@/components/landing/footer";
import { NewSimulationWizard } from "@/components/workspace/new-simulation-wizard";
import { fetchDatasetById } from "@/lib/repository/actions";

/**
 * Steps 2–4 of the new-simulation flow, once a base snapshot has already
 * been chosen (`/workspace/new/pick`, or a "recent snapshot" shortcut on
 * `/workspace/new`). `snapshotId` is read here, server-side, rather than
 * threaded through client state across routes.
 */
export default async function ConfigureSimulationPage({
  searchParams,
}: {
  searchParams: Promise<{ snapshotId?: string }>;
}) {
  const session = await auth();
  if (!session) redirect("/auth/signin");

  const { snapshotId } = await searchParams;
  if (!snapshotId) redirect("/workspace/new/pick");

  const snapshot = await fetchDatasetById(snapshotId);
  if (!snapshot) notFound();

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1">
        <NewSimulationWizard snapshot={snapshot} />
      </main>
      <Footer />
    </div>
  );
}
