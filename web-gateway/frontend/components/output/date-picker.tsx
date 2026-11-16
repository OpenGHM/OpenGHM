"use client";

import { useMemo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { OutputResolution } from "@/lib/repository/output";
import { MONTH_NAMES, convertDate } from "@/lib/output/view";
import { SELECT_CLASS } from "./style-controls";

/**
 * A step of the output: year, then month, then day as far as the resolution
 * goes, each list holding only what exists, and previous/next over the steps
 * the inventory lists (a run that starts in March has no January).
 */
export function DatePicker({
  resolution,
  steps,
  date,
  onChange,
}: {
  resolution: OutputResolution;
  steps: string[];
  date: string;
  onChange: (date: string) => void;
}) {
  const [y, m, d] = date.split("-");
  const index = steps.indexOf(date);

  const lists = useMemo(() => {
    const years = [...new Set(steps.map((s) => s.slice(0, 4)))];
    const months = [...new Set(steps.filter((s) => s.startsWith(y)).map((s) => s.slice(5, 7)))].filter(Boolean);
    const days = steps.filter((s) => s.startsWith(`${y}-${m}`)).map((s) => s.slice(8, 10));
    return { years, months, days };
  }, [steps, y, m]);

  const pick = (target: string) => {
    const next = convertDate(target, steps);
    if (next) onChange(next);
  };

  return (
    <div className="flex items-center gap-1.5">
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="size-9"
        aria-label="Previous step"
        disabled={index <= 0}
        onClick={() => onChange(steps[index - 1])}
      >
        <ChevronLeft aria-hidden="true" />
      </Button>
      <select
        className={SELECT_CLASS}
        aria-label="Year"
        value={y}
        onChange={(event) => pick([event.target.value, m, d].filter(Boolean).join("-"))}
      >
        {lists.years.map((year) => (
          <option key={year} value={year}>
            {year}
          </option>
        ))}
      </select>
      {resolution !== "yearly" && m && (
        <select
          className={SELECT_CLASS}
          aria-label="Month"
          value={m}
          onChange={(event) => pick([y, event.target.value, d].filter(Boolean).join("-"))}
        >
          {lists.months.map((month) => (
            <option key={month} value={month}>
              {MONTH_NAMES[Number(month) - 1]}
            </option>
          ))}
        </select>
      )}
      {resolution === "daily" && d && (
        <select className={SELECT_CLASS} aria-label="Day" value={d} onChange={(event) => pick(`${y}-${m}-${event.target.value}`)}>
          {lists.days.map((day) => (
            <option key={day} value={day}>
              {Number(day)}
            </option>
          ))}
        </select>
      )}
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="size-9"
        aria-label="Next step"
        disabled={index < 0 || index >= steps.length - 1}
        onClick={() => onChange(steps[index + 1])}
      >
        <ChevronRight aria-hidden="true" />
      </Button>
    </div>
  );
}
