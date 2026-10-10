import { ArrowDown, ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { ContentState, WorkshopStatus } from "@/lib/community/types";

/** The classes of a multi-line field, as the publish sheet writes them. */
export const TEXTAREA_CLASS =
  "w-full rounded-xl border border-input bg-card px-3.5 py-2 text-base outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30 aria-invalid:border-destructive aria-invalid:ring-destructive/20 md:text-sm";

/** A native select, styled to sit beside `Input`. */
export const SELECT_CLASS =
  "h-10 w-full min-w-0 rounded-xl border border-input bg-card px-3 text-base outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30 aria-invalid:border-destructive disabled:cursor-not-allowed disabled:opacity-50 md:text-sm";

/** A problem under its field. */
export function FieldError({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <p id={id} className="text-xs text-destructive">
      {children}
    </p>
  );
}

/**
 * A labelled field: the label, the control, a hint under it and the problem the
 * backend or a check found. `children` is a function so the control can take
 * the ids it must carry (`id`, `aria-describedby`, `aria-invalid`).
 */
export function Field({
  id,
  label,
  optional = false,
  hint,
  error,
  className,
  children,
}: {
  id: string;
  label: string;
  optional?: boolean;
  hint?: React.ReactNode;
  error?: string;
  className?: string;
  children: (props: { id: string; "aria-describedby"?: string; "aria-invalid"?: true }) => React.ReactNode;
}) {
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ");
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
        {optional && <span className="font-normal"> (optional)</span>}
      </Label>
      {children({
        id,
        "aria-describedby": describedBy || undefined,
        "aria-invalid": error ? true : undefined,
      })}
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
    </div>
  );
}

/** Draft or Published, as a pill. Published is the one that is on the site. */
export function StatePill({ state }: { state: ContentState }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold",
        state === "published"
          ? "border-success/25 bg-success/10 text-success"
          : "border-border bg-muted text-muted-foreground"
      )}
    >
      {state === "published" ? "Published" : "Draft"}
    </span>
  );
}

/** Upcoming or past, from the backend's date check. */
export function WorkshopStatusPill({ status }: { status: WorkshopStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold",
        status === "upcoming"
          ? "border-info/25 bg-info/10 text-info"
          : "border-border bg-muted text-muted-foreground"
      )}
    >
      {status === "upcoming" ? "Upcoming" : "Past"}
    </span>
  );
}

/** Up and down buttons for a row in a list a person can reorder. */
export function ReorderButtons({
  index,
  count,
  noun,
  onMove,
  disabled = false,
}: {
  index: number;
  count: number;
  /** What the row is, for the buttons' names ("detail", "material"). */
  noun: string;
  onMove: (from: number, to: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex shrink-0 gap-0.5">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-10 text-muted-foreground md:size-8"
        disabled={disabled || index === 0}
        aria-label={`Move ${noun} ${index + 1} up`}
        onClick={() => onMove(index, index - 1)}
      >
        <ArrowUp aria-hidden="true" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-10 text-muted-foreground md:size-8"
        disabled={disabled || index === count - 1}
        aria-label={`Move ${noun} ${index + 1} down`}
        onClick={() => onMove(index, index + 1)}
      >
        <ArrowDown aria-hidden="true" />
      </Button>
    </div>
  );
}

/** A card section's heading, in the card recipe: an icon tile and a 17 px title. */
export function SectionHeading({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" }>;
  title: string;
  description?: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-secondary text-primary">
        <Icon className="size-4" />
      </span>
      <div className="min-w-0">
        <h2 className="text-[17px] leading-tight font-semibold text-foreground">{title}</h2>
        {description && <p className="mt-0.5 text-sm font-normal text-muted-foreground">{description}</p>}
      </div>
    </div>
  );
}
