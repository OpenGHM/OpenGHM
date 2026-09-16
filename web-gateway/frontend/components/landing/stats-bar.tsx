const STATS = [
  { value: "1.2 PB+", label: "Hydrologic Data" },
  { value: "40+", label: "Global Models" },
  { value: "2,500+", label: "Research Users" },
  { value: "50k+", label: "Simulations Run" },
];

export function StatsBar() {
  return (
    <section className="border-b border-white/10 bg-[#0f172a] py-10 text-white">
      <div className="mx-auto grid max-w-[1280px] grid-cols-4 gap-10 px-10 text-center">
        {STATS.map((stat) => (
          <div key={stat.label}>
            <h3 className="mb-2 text-4xl font-bold text-accent">
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
