import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Header } from "@/components/landing/header";
import { Footer } from "@/components/landing/footer";
import { SnapshotSelectionClient } from "@/components/jobs/snapshot-selection-client";
import { fetchSnapshots } from "@/lib/jobs/actions";
import type { RepositoryListResponse } from "@/lib/repository/types";
import { ChevronRight } from "lucide-react";

const EMPTY_RESULT: RepositoryListResponse = {
  items: [],
  totalCount: 0,
  totalPages: 1,
  page: 1,
};

export default async function NewSimulationPage() {
  const session = await auth();
  if (!session) redirect("/auth/signin");

  let initialData: RepositoryListResponse = EMPTY_RESULT;
  try {
    initialData = await fetchSnapshots("", 1);
  } catch {
    // Backend unavailable — client will retry on interaction
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1">
        {/* Hero */}
        <div className="bg-gradient-to-br from-[#0a192f] to-[#006994] px-10 py-12">
          <div className="mx-auto max-w-[1024px]">
            {/* Breadcrumb */}
            <nav className="mb-4 flex items-center gap-1.5 text-xs text-white/60">
              <Link href="/simulations" className="hover:text-white/90 transition-colors">
                My Simulations
              </Link>
              <ChevronRight className="size-3" />
              <span className="text-white/90">New Simulation</span>
            </nav>

            <div>
              <p className="mb-1 text-sm font-medium text-white/60 uppercase tracking-wider">
                Step 1 of 2
              </p>
              <h1 className="text-3xl font-bold text-white">Select a Snapshot</h1>
              <p className="mt-2 text-sm text-white/70">
                Choose a model snapshot to use as the basis for your simulation
              </p>
            </div>
          </div>
        </div>

        {/* Snapshot grid */}
        <div className="bg-slate-50">
          <SnapshotSelectionClient initialData={initialData} />
        </div>
      </main>
      <Footer />
    </div>
  );
}
