const COLORS = [
  "bg-violet-500",
  "bg-blue-500",
  "bg-emerald-500",
  "bg-rose-500",
  "bg-amber-500",
  "bg-cyan-500",
  "bg-fuchsia-500",
];

export function UserAvatar({
  name,
  email,
  className = "h-7 w-7 text-xs",
}: {
  name?: string | null;
  email?: string | null;
  className?: string;
}) {
  const display = name ?? email ?? "?";
  const initials = display
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const bg = COLORS[display.charCodeAt(0) % COLORS.length];

  return (
    <span
      className={`inline-flex items-center justify-center rounded-full font-semibold text-white ${bg} ${className}`}
    >
      {initials}
    </span>
  );
}
