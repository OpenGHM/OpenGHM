import Link from "next/link";

export function CtaSection() {
  return (
    <section className="bg-primary py-24 text-center text-white">
      <div className="mx-auto max-w-[800px] px-10">
        <h2 className="mb-6 text-[40px] font-extrabold">
          Ready to Accelerate Your Research?
        </h2>
        <p className="mb-10 text-lg leading-relaxed opacity-90">
          Join hundreds of hydrologists using OpenGHM to process data faster and
          simulate smarter. Get started for free today.
        </p>
        <div className="flex justify-center gap-4">
          <Link
            href="/repository"
            className="inline-flex items-center justify-center rounded-xl bg-white px-9 py-4 text-base font-semibold text-primary transition-all hover:bg-white/90"
          >
            Explore Data Repository
          </Link>
          <button className="rounded-xl border border-white/20 bg-black/20 px-9 py-4 text-base font-semibold text-white transition-all hover:bg-black/30">
            View Documentation
          </button>
        </div>
      </div>
    </section>
  );
}
