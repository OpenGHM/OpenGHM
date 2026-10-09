import { Loader2 } from "lucide-react";
import { Header } from "@/components/landing/header";
import { Footer } from "@/components/landing/footer";

/**
 * Shown while the new snapshot draft's defaults and its snapshot are read. The
 * Header and Footer are there at once and a plain spinner sits between them;
 * it is invisible for the first 300 ms (`reveal-delayed`), so a fast load
 * shows no placeholder at all.
 */
export default function NewDraftLoading() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main className="reveal-delayed flex flex-1 items-center justify-center px-4 py-24">
        <div
          role="status"
          aria-label="Loading snapshot draft"
          className="flex items-center gap-3 rounded-card bg-card px-6 py-4 text-sm text-muted-foreground shadow-card"
        >
          <Loader2 className="size-5 motion-safe:animate-spin" aria-hidden="true" />
          Loading snapshot draft…
        </div>
      </main>

      <Footer />
    </div>
  );
}
