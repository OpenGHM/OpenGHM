import { GroupsPreview } from "@/components/community/groups-preview";
import type { CommunitySettings } from "@/lib/community/types";

/**
 * The Discussion groups band: a navy panel with a "Coming soon · Preview"
 * pill, the admin's heading and intro, and an illustration of what a group
 * will look like (`GroupsPreview`, not interactive). Groups do not exist yet,
 * so the band says so; the page leaves it out when the settings switch it
 * off.
 */
export function GroupsSection({ settings }: { settings: Pick<CommunitySettings, "groups_title" | "groups_intro"> }) {
  return (
    <section
      aria-labelledby="groups-heading"
      className="relative flex flex-col gap-7 overflow-hidden rounded-panel bg-hero p-[clamp(24px,4vw,48px)] text-hero-foreground"
    >
      <div aria-hidden="true" className="hero-dots pointer-events-none absolute inset-0" />
      <div className="relative flex max-w-[620px] flex-col gap-3">
        <span className="w-fit rounded-full border border-dashed border-hero-attention/70 px-2.5 py-1 text-xs font-semibold text-hero-attention-text">
          Coming soon · Preview
        </span>
        <h2
          id="groups-heading"
          className="text-[clamp(28px,3.4vw,40px)] leading-[1.1] font-bold tracking-[-0.035em] text-white text-balance"
        >
          {settings.groups_title}
        </h2>
        {settings.groups_intro && (
          <p className="text-[15.5px] leading-[1.6] text-hero-foreground-muted text-pretty">{settings.groups_intro}</p>
        )}
      </div>
      <div className="relative">
        <GroupsPreview />
      </div>
    </section>
  );
}
