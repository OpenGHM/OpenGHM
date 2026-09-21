import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Header } from "@/components/landing/header";
import { Footer } from "@/components/landing/footer";
import { NewSimulationWizard } from "@/components/workspace/new-simulation-wizard";
import { fetchSnapshots } from "@/lib/jobs/actions";
import type { RepositoryListResponse } from "@/lib/repository/types";

const EMPTY_RESULT: RepositoryListResponse = {
  items: [],
  totalCount: 0,
  totalPages: 1,
  page: 1,
};

export default async function NewSimulationPage() {
  const session = await auth();
  if (!session) redirect("/auth/signin");

  let initialSnapshots: RepositoryListResponse = EMPTY_RESULT;
  try {
    initialSnapshots = await fetchSnapshots("", 1);
  } catch {
    // Backend unavailable — the wizard's snapshot step will retry on interaction.
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1">
        <NewSimulationWizard initialSnapshots={initialSnapshots} />
      </main>
      <Footer />
    </div>
  );
}
