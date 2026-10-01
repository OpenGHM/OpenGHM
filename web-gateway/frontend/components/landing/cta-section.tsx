import Link from "next/link";

export function CtaSection() {
  return (
    <section className="bg-primary py-16 text-center lg:py-24 text-white">
      <div className="mx-auto max-w-[800px] px-4 sm:px-6 lg:px-10">
        <h2 className="mb-6 text-3xl font-extrabold sm:text-4xl lg:text-[40px]">
          Ready to Accelerate Your Research?
        </h2>
        <p className="mb-8 text-lg lg:mb-10 leading-relaxed opacity-90">
          Join hundreds of hydrologists using OpenGHM to process data faster and
          simulate smarter. Get started for free today.
        </p>
        <div className="flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center sm:gap-4">
          <Link
            href="/repository"
            className="inline-flex items-center justify-center min-h-12 rounded-xl bg-white px-6 py-3 sm:px-9 sm:py-4 text-base font-semibold text-primary transition-all hover:bg-white/90"
          >
            Explore Data Repository
          </Link>
          <button className="min-h-12 rounded-xl border border-white/20 bg-black/20 px-6 py-3 sm:px-9 sm:py-4 text-base font-semibold text-white transition-all hover:bg-black/30">
            View Documentation
          </button>
        </div>
      </div>
    </section>
  );
}
