import { Loader2 } from "lucide-react";
import { Header } from "@/components/landing/header";
import { Footer } from "@/components/landing/footer";

/**
 * Shown while a simulation's page is fetched. A draft and a submitted job look
 * nothing alike, and this cannot know which it is waiting for, so it promises
 * neither: the Header and Footer are there at once and a plain spinner sits
 * between them. It is invisible for the first 300 ms (`reveal-delayed`), so a
 * fast load shows no placeholder at all.
 */
export default function JobDetailLoading() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main className="reveal-delayed flex flex-1 items-center justify-center bg-slate-50 px-4 py-24">
        <div role="status" aria-label="Loading simulation" className="flex items-center gap-3 text-sm text-muted-foreground">
          <Loader2 className="size-5 motion-safe:animate-spin" aria-hidden="true" />
          Loading simulation…
        </div>
      </main>

      <Footer />
    </div>
  );
}
