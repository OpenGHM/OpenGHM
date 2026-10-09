"use client";

import { CircleHelp } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useWizardHelp } from "@/components/workspace/wizard-help-context";
import { cn } from "@/lib/utils";
import { helpIndex, helpTopic, type HelpTopic } from "@/lib/workspace/wizard-help";

/** A topic's heading and blocks: a few short paragraphs or bullets. */
function TopicBody({ topic }: { topic: HelpTopic }) {
  return (
    <>
      <h3 className="text-base font-semibold text-foreground">{topic.title}</h3>
      {topic.blocks.map((block, i) =>
        block.kind === "text" ? (
          <p key={i} className="text-sm leading-relaxed text-foreground/85">
            {block.text}
          </p>
        ) : (
          <ul key={i} className="list-disc space-y-2 pl-4 text-sm leading-relaxed text-foreground/85 marker:text-muted-foreground">
            {block.items.map((item, j) => (
              <li key={j}>{item}</li>
            ))}
          </ul>
        )
      )}
    </>
  );
}

/**
 * What the help panel says now: the help of the section the person last
 * focused or pointed at, else the step's overview (`helpTopic`). Above it, when
 * the step has sections, an index (`helpIndex`) lists every topic and marks the
 * one shown (`aria-current`); choosing an entry shows that topic and moves
 * nothing else. The body is a polite live region, so a screen reader hears
 * the new text after it has finished what it is saying; the panel never takes
 * focus.
 *
 * `plain` is the contents without the card around them, for the sheet.
 * Nothing is drawn outside a `WizardHelpProvider`.
 */
export function WizardHelpPanel({ plain = false, className }: { plain?: boolean; className?: string }) {
  const help = useWizardHelp();
  if (!help) return null;
  const topic = helpTopic(help.step, help.section, help.facts);
  const index = helpIndex(help.step, help.facts);

  const body = (
    <>
      {index.length > 0 && (
        <nav aria-label="Help topics" className="border-b pb-3">
          <ul className="space-y-0.5">
            {index.map((entry) => {
              const current = entry.section === help.section;
              return (
                <li key={entry.section ?? "overview"}>
                  <button
                    type="button"
                    aria-current={current ? "true" : undefined}
                    onClick={() => help.showSection(entry.section)}
                    className={cn(
                      "flex min-h-10 w-full items-center rounded-r border-l-2 px-3 text-left text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:min-h-8",
                      current
                        ? "border-primary font-medium text-foreground"
                        : "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    {entry.title}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
      <div aria-live="polite" aria-atomic="true" className="space-y-3">
        <TopicBody topic={topic} />
      </div>
    </>
  );

  if (plain) return <div className={cn("space-y-3", className)}>{body}</div>;

  return (
    <div
      className={cn("overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm", className)}
    >
      <div className="flex items-center gap-2 border-b bg-muted/50 px-5 py-3 font-mono text-xs tracking-wider text-muted-foreground uppercase">
        <CircleHelp aria-hidden="true" className="size-4" />
        Help
      </div>
      <div className="space-y-3 px-5 py-5">{body}</div>
    </div>
  );
}

/**
 * Below `xl` the panel has no column, so this button opens the same help in a
 * sheet over the right edge (the Details sheet's component). It sits beside a
 * step's heading and is gone from `xl` up, where the panel is on the page.
 * Nothing is drawn outside a `WizardHelpProvider`.
 */
export function WizardHelpButton({ className }: { className?: string }) {
  const help = useWizardHelp();
  if (!help) return null;
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn("min-h-10 shrink-0 gap-1.5 sm:min-h-8 xl:hidden", className)}
        >
          <CircleHelp aria-hidden="true" />
          Help
        </Button>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 text-base">
            <CircleHelp aria-hidden="true" className="size-4 text-muted-foreground" />
            Help
          </SheetTitle>
          <SheetDescription className="sr-only">
            What this step of the snapshot draft asks for, and what it does.
          </SheetDescription>
        </SheetHeader>
        <SheetBody>
          <WizardHelpPanel plain />
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
