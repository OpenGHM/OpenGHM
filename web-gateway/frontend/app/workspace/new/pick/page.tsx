import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Header } from "@/components/landing/header";
import { Footer } from "@/components/landing/footer";
import { WizardProgress } from "@/components/workspace/wizard-progress";
import { SnapshotPickerClient } from "@/components/workspace/snapshot-picker-client";
import { fetchDatasets, fetchModelInputIds } from "@/lib/repository/actions";
import { parseDatasetFilters, toURLSearchParams } from "@/lib/repository/url-filters";
import type { RepositoryListResponse } from "@/lib/repository/types";

const EMPTY_RESULT: RepositoryListResponse = {
  items: [],
  totalCount: 0,
  totalPages: 1,
  page: 1,
};

export default async function PickSnapshotPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session) redirect("/auth/signin");

  const rawParams = await searchParams;
  const params = toURLSearchParams(rawParams);
  const filters = parseDatasetFilters(params);

  let initialData: RepositoryListResponse = EMPTY_RESULT;
  try {
    initialData = await fetchDatasets(filters);
  } catch {
    // Backend unavailable — the client will retry on interaction.
  }

  let initialModelInputIds: Set<string> | null = null;
  try {
    initialModelInputIds = await fetchModelInputIds();
  } catch {
    // Badge degrades to "Checking…" client-side.
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1">
        <WizardProgress step="snapshot" />
        <div className="bg-slate-50">
          <div className="mx-auto flex max-w-[1280px] items-center px-10 pt-6">
            <Link
              href="/workspace/new"
              className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="mr-1.5 size-4" />
              Cancel — back to New Simulation
            </Link>
          </div>
          <SnapshotPickerClient
            initialFilters={filters}
            initialData={initialData}
            initialModelInputIds={initialModelInputIds}
          />
        </div>
      </main>
      <Footer />
    </div>
  );
}
