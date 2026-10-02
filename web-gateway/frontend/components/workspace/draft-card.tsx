import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const TONES = {
  primary: { bar: "from-primary/5", chip: "bg-primary/10", icon: "text-primary" },
  compute: { bar: "from-compute/5", chip: "bg-compute/10", icon: "text-compute" },
} as const;

/**
 * The card every draft-wizard step is made of: a titled bar (with an optional
 * action, such as an Edit link, at its end) over a padded body. Same look as the
 * detail page's cards, written once so the four steps do not each repeat it.
 */
export function DraftCard({
  title,
  icon: Icon,
  tone = "primary",
  action,
  className,
  contentClassName,
  children,
}: {
  title: string;
  icon?: LucideIcon;
  tone?: keyof typeof TONES;
  action?: ReactNode;
  className?: string;
  contentClassName?: string;
  children: ReactNode;
}) {
  const t = TONES[tone];
  return (
    <Card className={cn("gap-0 overflow-hidden rounded-xl border-0 py-0 shadow-sm", className)}>
      <CardHeader
        className={cn(
          "grid-rows-1 items-center !gap-0 border-b bg-gradient-to-r to-transparent !py-3",
          t.bar
        )}
      >
        <div className="flex min-w-0 items-center justify-between gap-3">
          <h3 className="flex min-w-0 items-center gap-2 text-base font-semibold text-foreground">
            {Icon && (
              <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", t.chip)}>
                <Icon className={cn("size-4", t.icon)} aria-hidden="true" />
              </span>
            )}
            <span className="min-w-0 break-words">{title}</span>
          </h3>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      </CardHeader>
      <CardContent className={cn("space-y-4 pt-5 pb-6", contentClassName)}>{children}</CardContent>
    </Card>
  );
}

/** One labelled value in a summary: the label above the value on a phone, beside
 *  it from `sm` up. */
export function SummaryRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5 rounded-md bg-muted/40 px-3 py-2 sm:grid-cols-[8rem_1fr] sm:gap-3">
      <dt className="text-xs text-muted-foreground sm:pt-0.5">{label}</dt>
      <dd className="min-w-0 break-words font-medium text-foreground">{children}</dd>
    </div>
  );
}
