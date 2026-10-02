import Link from "next/link";
import type { ReactNode } from "react";
import { SearchX } from "lucide-react";
import { TimeStamp } from "@/components/common/time-stamp";
import type { Dataset } from "@/lib/repository/types";
import { TagChips } from "@/components/repository/tag-chips";

/**
 * The one snapshot-list presentation, shared by `/repository` (browse) and
 * the Start screen's picker (`/workspace/new`) — spec.md's "one list
 * component serving both ... differing by the action it renders per row."
 *
 * Browse passes neither `onNameClick` nor `renderAction`: the name is a
 * plain link to the detail page, and the action column doesn't render at
 * all — not a disabled button, an absent one, so a picker row and a browse
 * row are never visually interchangeable.
 */

function ModelInputBadge({
  modelInputId,
  modelInputIds,
}: {
  modelInputId: string;
  modelInputIds: Set<string> | null;
}) {
  if (modelInputIds === null) {
    return (
      <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
        Checking…
      </span>
    );
  }
  const present = modelInputIds.has(modelInputId);
  return (
    <span
      title={modelInputId}
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
        present ? "bg-success/10 text-success" : "bg-warning/10 text-warning"
      }`}
    >
      {present ? "Present" : "Missing"}
    </span>
  );
}

export function DatasetTable({
  datasets,
  modelInputIds,
  selectedId = null,
  onNameClick,
  renderAction,
}: {
  datasets: Dataset[];
  /** `null` while the model-input catalogue hasn't loaded yet. */
  modelInputIds: Set<string> | null;
  selectedId?: string | null;
  /** Picker mode: clicking the name opens a detail panel in place instead
   *  of navigating. Absent (browse mode) → the name links to the detail page. */
  onNameClick?: (dataset: Dataset) => void;
  /** Picker mode: the commit control for a row. Absent (browse mode) →
   *  the action column does not render at all. */
  renderAction?: (dataset: Dataset) => ReactNode;
}) {
  if (datasets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <SearchX className="mb-4 size-12 text-muted-foreground/40" />
        <h3 className="text-lg font-semibold text-foreground">No datasets found</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Try adjusting your search or filters
        </p>
      </div>
    );
  }

  /** The name: a button in picker mode, a link to the detail page otherwise. */
  const nameControl = (dataset: Dataset, className: string) =>
    onNameClick ? (
      <button
        type="button"
        onClick={() => onNameClick(dataset)}
        className={`text-left font-medium text-primary hover:underline ${className}`}
      >
        {dataset.about.name}
      </button>
    ) : (
      <Link
        href={`/repository/${dataset.id}`}
        className={`font-medium text-foreground hover:text-primary hover:underline ${className}`}
      >
        {dataset.about.name}
      </Link>
    );

  // Two layouts, and CSS shows one: the real table from `sm` up, a list of
  // cards below it. The hidden one is `display: none`, so it is out of the
  // accessibility tree and the tab order, and a screen reader meets a table
  // or a list, never both. (A table forced to `display: block` loses its
  // table semantics, which is why it is not one layout.)
  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <table aria-label="Datasets" className="hidden w-full text-sm sm:table">
        <thead>
          <tr className="border-b bg-muted/40 text-left text-xs font-semibold text-muted-foreground">
            <th className="px-4 py-3">Name</th>
            <th className="px-4 py-3">Period</th>
            <th className="px-4 py-3">Resolution</th>
            <th className="px-4 py-3">WBM Version</th>
            <th className="px-4 py-3">Model Input</th>
            <th className="px-4 py-3">Published</th>
            {renderAction && (
              <th className="sticky right-0 bg-card px-4 py-3">
                <span className="sr-only">Action</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {datasets.map((dataset) => {
            const { start, end } = dataset.simulation.temporalCoverage;
            const { value, unit } = dataset.simulation.resolution;
            const isSelected = dataset.id === selectedId;
            return (
              <tr
                key={dataset.id}
                className={`border-b last:border-0 ${isSelected ? "bg-primary/5" : "hover:bg-muted/20"}`}
              >
                <td className="max-w-[280px] px-4 py-3">
                  <div className="flex items-start gap-2">{nameControl(dataset, "")}</div>
                  <div className="mt-1">
                    <TagChips tags={dataset.about.tags} size="sm" />
                  </div>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                  {start} – {end}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                  {value} {unit}
                </td>
                <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-muted-foreground">
                  {dataset.uses.container.version}
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  <ModelInputBadge
                    modelInputId={dataset.uses.modelInput.id}
                    modelInputIds={modelInputIds}
                  />
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                  <TimeStamp value={dataset.generatedAt} format="date" />
                </td>
                {renderAction && (
                  // Stays in view when a narrow container scrolls the table sideways.
                  <td className="sticky right-0 whitespace-nowrap bg-card px-4 py-3 text-right shadow-[-8px_0_8px_-8px_rgba(0,0,0,0.12)]">
                    {renderAction(dataset)}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>

      <ul aria-label="Datasets" role="list" className="sm:hidden">
        {datasets.map((dataset) => {
          const { start, end } = dataset.simulation.temporalCoverage;
          const { value, unit } = dataset.simulation.resolution;
          const isSelected = dataset.id === selectedId;
          return (
            <li
              key={dataset.id}
              className={`border-b px-4 py-4 last:border-0 ${isSelected ? "bg-primary/5" : ""}`}
            >
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                {nameControl(dataset, "min-w-0 py-2 break-words")}
                <TagChips tags={dataset.about.tags} size="sm" />
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {start} – {end}
                <span aria-hidden="true" className="mx-2">
                  ·
                </span>
                {value} {unit}
                <span aria-hidden="true" className="mx-2">
                  ·
                </span>
                <span className="font-mono text-xs">{dataset.uses.container.version}</span>
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                <ModelInputBadge
                  modelInputId={dataset.uses.modelInput.id}
                  modelInputIds={modelInputIds}
                />
                <span>
                  Published <TimeStamp value={dataset.generatedAt} format="date" />
                </span>
              </div>
              {renderAction && <div className="mt-3">{renderAction(dataset)}</div>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
