/**
 * The strip across the top of every page while the site is in development
 * (AGENTS.md rule 1: nothing is released yet). The root layout renders it above
 * everything else; it scrolls away with the page and cannot be dismissed.
 * Delete it, and its line in `app/layout.tsx`, when the first release is out.
 */
export function DevelopmentNotice() {
  return (
    <div role="note" className="bg-hero-attention px-4 py-1.5 text-center text-[13px] leading-5 text-hero">
      <strong className="font-semibold">This website is under development.</strong>{" "}
      Features and data may change, and some are not available yet.
    </div>
  );
}
