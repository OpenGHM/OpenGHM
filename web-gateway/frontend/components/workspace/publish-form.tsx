"use client";

import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, BadgeCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import type { Job } from "@/lib/jobs/types";

/**
 * Turning a finished run into a published, citable snapshot. There is no
 * route behind this — publishing a job's output is blocked behind several
 * open items (docs/reference/open-items.md) — so this is entirely a mock of
 * the flow a user would go through, with a submit button that explains
 * itself instead of silently doing nothing.
 */
export function PublishForm({ job }: { job: Job }) {
  const [title, setTitle] = useState(job.about?.name ?? job.dataset_title);
  const [description, setDescription] = useState(job.about?.description ?? "");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setTimeout(() => {
      setSubmitting(false);
      toast.error("Publishing isn't wired up yet — see docs/reference/open-items.md.");
    }, 400);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="flex items-start gap-3 rounded-lg border border-warning/25 bg-warning/5 p-3 text-sm text-warning">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <div>
          <p className="font-medium">Not wired up</p>
          <p className="mt-0.5 text-xs">
            No route publishes a job&apos;s output as a snapshot yet — nothing
            runs real WBM and nothing writes output to S3. This form shows the
            flow a user would go through; submitting it does nothing real.
          </p>
        </div>
      </div>

      <Card className="rounded-xl border-0 shadow-sm">
        <CardContent className="space-y-4 pt-6">
          <div className="space-y-1.5">
            <Label htmlFor="publish-title">Title</Label>
            <Input
              id="publish-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="publish-description">Description</Label>
            <textarea
              id="publish-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            />
          </div>
          <div className="rounded-lg bg-slate-50 p-3 text-xs text-muted-foreground">
            Output files carried over: {job.output_s3_key ?? "none recorded"}. A
            real publish would need output actually in S3 first (open item
            Next 8) and a route that snapshots it immutably (rule 1) with a
            new identity (rule 2) — neither exists yet.
          </div>
        </CardContent>
      </Card>

      <Button type="submit" disabled={submitting} className="gap-1.5 hover:bg-accent">
        <BadgeCheck className="size-4" />
        {submitting ? "Submitting..." : "Publish Snapshot"}
      </Button>
    </form>
  );
}
