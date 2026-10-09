const STATS = [
  { value: "1.2 PB+", label: "Hydrologic Data" },
  { value: "40+", label: "Global Models" },
  { value: "2,500+", label: "Research Users" },
  { value: "50k+", label: "Simulations Run" },
];

export function StatsBar() {
  return (
    <section className="border-b border-white/10 bg-[#0f172a] py-8 text-white lg:py-10">
      <div className="mx-auto grid max-w-[1280px] grid-cols-2 gap-x-4 gap-y-8 px-4 text-center sm:px-6 lg:grid-cols-4 lg:gap-10 lg:px-10">
        {STATS.map((stat) => (
          <div key={stat.label}>
            <h3 className="mb-2 text-3xl sm:text-4xl font-bold text-hero-eyebrow">
              {stat.value}
            </h3>
            <p className="text-sm font-medium uppercase tracking-wider text-slate-400">
              {stat.label}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
