import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * An illustration of what discussion groups will look like: a group list, a
 * conversation with a shared snapshot draft, and a message box. Nothing in it
 * works and none of it is real content, so it is `aria-hidden` and `inert`
 * (no focus, no clicks); the sample names and messages live here, not in the
 * CMS. A screen reader gets the band's heading and text instead.
 */

const PEOPLE = {
  MJ: { name: "Mia Johnson", tone: "bg-primary" },
  DG: { name: "Dan Garcia", tone: "bg-success" },
  SK: { name: "Sara Kim", tone: "bg-compute" },
  AP: { name: "Alex Park", tone: "bg-highlight" },
} as const;

type Person = keyof typeof PEOPLE;

const GROUPS: { name: string; initials: string; tone: string; members: string; unread?: number; current?: boolean }[] = [
  { name: "WBM CONUS", initials: "WC", tone: "bg-primary", members: "42 members", current: true },
  { name: "Water tracking", initials: "WT", tone: "bg-data-3", members: "18 members" },
  { name: "Purdue Hydro Lab", initials: "PH", tone: "bg-highlight", members: "7 members", unread: 1 },
  { name: "Teaching with OpenGHM", initials: "TE", tone: "bg-compute", members: "25 members" },
];

const VARIABLES = [
  { name: "runoff", tone: "bg-data-1" },
  { name: "discharge", tone: "bg-data-2" },
  { name: "streamAge", tone: "bg-data-3" },
];

function Avatar({ person, className }: { person: Person; className?: string }) {
  return (
    <span className={cn("grid place-items-center rounded-full font-bold text-white", PEOPLE[person].tone, className)}>
      {person}
    </span>
  );
}

export function GroupsPreview() {
  return (
    <div
      aria-hidden="true"
      inert
      className="relative flex min-h-[520px] flex-wrap overflow-hidden rounded-card bg-card text-foreground shadow-float select-none"
    >
      <aside className="flex min-w-0 flex-[1_1_230px] flex-col gap-3.5 border-r border-border bg-muted px-3 py-4">
        <div className="flex h-[38px] items-center gap-2 rounded-[10px] border border-border bg-card px-3 text-[13px] text-muted-foreground">
          <Search className="size-[13px]" />
          Find a group
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="px-2.5 py-1 font-mono text-[11px] tracking-[0.06em] text-muted-foreground">YOUR GROUPS</span>
          {GROUPS.map((g) => (
            <div
              key={g.name}
              className={cn("flex items-center gap-2.5 rounded-[10px] px-2.5 py-[9px]", g.current && "bg-card")}
            >
              <span className={cn("grid size-[30px] shrink-0 place-items-center rounded-[9px] text-xs font-bold text-white", g.tone)}>
                {g.initials}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-px">
                <span className={cn("truncate text-[13.5px]", g.current ? "font-semibold" : "font-medium")}>{g.name}</span>
                <span className="text-[11.5px] text-muted-foreground">{g.members}</span>
              </span>
              {g.unread && (
                <span className="min-w-5 rounded-full bg-primary px-1.5 py-0.5 text-center font-mono text-[11px] font-medium text-white">
                  {g.unread}
                </span>
              )}
            </div>
          ))}
        </div>
      </aside>

      <div className="flex min-w-0 flex-[999_1_420px] flex-col">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-[22px] py-4">
          <div className="flex flex-col gap-0.5">
            <span className="text-base font-semibold tracking-[-0.01em]">WBM CONUS</span>
            <span className="text-[12.5px] text-muted-foreground">Runs over the contiguous US</span>
          </div>
          <div className="flex items-center">
            {(["DG", "SK", "AP", "MJ"] as const).map((p) => (
              <Avatar key={p} person={p} className="-ml-1.5 size-7 border-2 border-card text-[10.5px]" />
            ))}
            <span className="ml-2 text-[12.5px] text-muted-foreground">42 members</span>
          </div>
        </div>

        <div className="flex flex-1 flex-col gap-[18px] overflow-hidden px-[22px] py-5">
          <Message
            person="DG"
            time="9:12 AM"
            text="Ran the CONUS tutorial for 2000–2001 and runoff in the Southwest looks low against the v2.0.0 baseline. Has anyone else seen this?"
          />
          <Message person="MJ" time="9:20 AM" text="Mine came out similar. Here is the run:">
            <div className="flex max-w-[440px] flex-col gap-3 rounded-2xl border border-border bg-card px-4 py-3.5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[11px] tracking-[0.06em] text-primary">SNAPSHOT DRAFT</span>
                <span className="flex items-center gap-1.5 rounded-full bg-success/10 px-[9px] py-[3px] text-[11.5px] font-semibold text-success">
                  <span className="size-1.5 rounded-full bg-success" />
                  Completed
                </span>
              </div>
              <div className="flex flex-col gap-[3px]">
                <span className="font-mono text-[14.5px] font-medium">sim-20261007-83f535</span>
                <span className="text-[12.5px] text-muted-foreground">WBM v2.0.0 CONUS tutorial simulation</span>
              </div>
              <div className="flex flex-col gap-[5px]">
                <div className="relative h-1.5 rounded-md bg-muted">
                  <div className="absolute inset-y-0 left-0 w-1/5 rounded-md bg-primary" />
                </div>
                <div className="flex justify-between font-mono text-[11px] text-muted-foreground">
                  <span>2000</span>
                  <span>2000–2001</span>
                  <span>2010</span>
                </div>
              </div>
              <div className="flex flex-wrap gap-[5px]">
                {VARIABLES.map((v) => (
                  <span key={v.name} className="flex items-center gap-[5px] rounded-full bg-muted px-2 py-[3px] font-mono text-[11.5px]">
                    <span className={cn("size-1.5 rounded-[2px]", v.tone)} />
                    {v.name}
                  </span>
                ))}
              </div>
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                <span className="rounded-[9px] bg-hero px-[11px] py-[7px] text-[12.5px] font-semibold text-white">Open</span>
                <span className="rounded-[9px] bg-muted px-[11px] py-[7px] text-[12.5px] font-semibold">Compare settings</span>
                <span className="rounded-[9px] bg-muted px-[11px] py-[7px] text-[12.5px] font-semibold">New run from this</span>
              </div>
            </div>
          </Message>
          <Message
            person="SK"
            time="9:34 AM"
            text="Your log summary shows ET Irr = 0.00 km3, so irrigation is off in this init. Try Compare settings against the published snapshot."
          />
        </div>

        <div className="border-t border-border px-[18px] pt-3.5 pb-[18px]">
          <div className="flex items-center gap-2 rounded-[14px] border-[1.5px] border-input bg-card py-1.5 pr-1.5 pl-2">
            <span className="flex h-9 items-center gap-1.5 rounded-[10px] bg-secondary px-[11px] text-[12.5px] font-semibold text-secondary-foreground">
              <span className="text-[15px] leading-none">+</span>Snapshot
            </span>
            <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">Message WBM CONUS</span>
            <span className="flex h-9 items-center rounded-[10px] bg-primary px-3.5 text-[13px] font-semibold text-white">Send</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Message({
  person,
  time,
  text,
  children,
}: {
  person: Person;
  time: string;
  text: string;
  /** What the message carries, drawn under its text. */
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <Avatar person={person} className="size-[34px] shrink-0 text-xs" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="flex items-baseline gap-2">
          <span className="text-[13.5px] font-semibold">{PEOPLE[person].name}</span>
          <span className="font-mono text-[11.5px] text-muted-foreground">{time}</span>
        </span>
        <p className="text-sm leading-[1.55] text-foreground/90 text-pretty">{text}</p>
        {children}
      </div>
    </div>
  );
}
