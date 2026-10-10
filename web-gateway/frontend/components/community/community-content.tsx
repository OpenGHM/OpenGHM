import { AlertCircle } from "lucide-react";
import { GroupsSection } from "@/components/community/groups-section";
import { PublicationsSection } from "@/components/community/publications-section";
import { TutorialsSection } from "@/components/community/tutorials-section";
import { WorkshopsSection } from "@/components/community/workshops-section";
import type { CommunityTab } from "@/lib/community/format";
import type { CommunityPage } from "@/lib/community/types";

/** Which sections the page shows for a tab, and whether it begins with a card. */
export function communityLayout(page: CommunityPage, tab: CommunityTab, failed = false) {
  const all = tab === "all";
  // On All a section with nothing published is left out; on its own tab it
  // says so. Groups has no content of its own: the settings switch it.
  const workshops = (all || tab === "workshops") && (!all || page.workshops.length > 0);
  const tutorials = (all || tab === "tutorials") && (!all || page.tutorials.length > 0);
  const publications = (all || tab === "publications") && (!all || page.publications.length > 0);
  const groups = (all || tab === "groups") && page.settings.show_groups;
  const empty = !failed && !workshops && !tutorials && !publications && !groups;
  return {
    workshops,
    tutorials,
    publications,
    groups,
    empty,
    // The page pulls its first card up into the navy band, so it only does
    // that when what comes first is a card: Workshops (a workshop or a note),
    // the error box, or the empty note. A section that opens with a heading
    // starts below the band.
    startsWithCard: failed || empty || workshops,
  };
}

function Note({ children, tone }: { children: React.ReactNode; tone?: "error" }) {
  return (
    <div
      role={tone === "error" ? "alert" : undefined}
      className={
        tone === "error"
          ? "flex items-start gap-3 rounded-card border border-destructive/25 bg-card p-6 text-[15px] text-destructive shadow-raised"
          : "rounded-card border border-dashed border-border bg-card px-6 py-10 text-center text-[15px] text-muted-foreground shadow-raised"
      }
    >
      {tone === "error" && <AlertCircle aria-hidden="true" className="mt-0.5 size-5 shrink-0" />}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/**
 * The sections of the Community page for the chosen tab, in the order
 * Workshops, Tutorials, Publications, Groups. `failed` is the backend not
 * answering: the page keeps its band and tabs and says so in place of the
 * content.
 */
export function CommunityContent({
  page,
  tab,
  failed = false,
  signedIn,
  here,
}: {
  page: CommunityPage;
  tab: CommunityTab;
  failed?: boolean;
  signedIn: boolean;
  here: string;
}) {
  const show = communityLayout(page, tab, failed);
  return (
    <>
      {failed && (
        <Note tone="error">
          <p className="font-medium">The Community page could not be loaded.</p>
          <p className="mt-1">
            The gateway could not reach its content service. Nothing is lost.{" "}
            {/* A plain link: a reload asks the service again, and a soft navigation to this same address would not. */}
            <a href={here} className="inline-flex min-h-10 items-center font-medium underline underline-offset-4">
              Reload the page
            </a>
          </p>
        </Note>
      )}
      {show.empty && <Note>Nothing is published here yet. Workshops, tutorials and publications appear as soon as they are.</Note>}
      {show.workshops && <WorkshopsSection workshops={page.workshops} />}
      {show.tutorials &&
        (page.tutorials.length > 0 ? (
          <TutorialsSection tutorials={page.tutorials} />
        ) : (
          <EmptySection title="Tutorials">No tutorials are published yet.</EmptySection>
        ))}
      {show.publications &&
        (page.publications.length > 0 ? (
          <PublicationsSection publications={page.publications} />
        ) : (
          <EmptySection title="Publications">No publications are listed yet.</EmptySection>
        ))}
      {show.groups && (
        <GroupsSection
          settings={page.settings}
          signedIn={signedIn}
          interested={page.group_interest}
          here={here}
        />
      )}
    </>
  );
}

function EmptySection({ title, children }: { title: string; children: string }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-2xl font-bold tracking-[-0.025em]">{title}</h2>
      <div className="rounded-card border border-dashed border-border bg-card px-6 py-10 text-center text-[15px] text-muted-foreground">
        {children}
      </div>
    </section>
  );
}
