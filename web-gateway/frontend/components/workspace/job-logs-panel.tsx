"use client";

import { useState, useTransition } from "react";
import { Terminal, ChevronDown, Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { SessionExpiredBanner } from "@/components/workspace/session-expired-banner";
import { fetchJobLogs } from "@/lib/jobs/actions";
import type { JobLogsResponse, JobStatus } from "@/lib/jobs/types";

interface Props {
  jobId: string;
  jobStatus: JobStatus;
  /** Fixture logs (see lib/workspace/fixtures.ts / lib/workspace/preview.ts)
   *  — there is no real job behind `jobId`, so this is shown immediately
   *  instead of a "Load Logs" fetch that would 404 against the real API. */
  previewLogs?: JobLogsResponse;
}

export function JobLogsPanel({ jobId, jobStatus, previewLogs }: Props) {
  const [stdout, setStdout] = useState<string | null>(previewLogs?.stdout ?? null);
  const [stderr, setStderr] = useState<string | null>(previewLogs?.stderr ?? null);
  const [truncated, setTruncated] = useState(previewLogs?.truncated ?? false);
  const [error, setError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [loaded, setLoaded] = useState(previewLogs !== undefined);
  const [loading, startLoad] = useTransition();
  const [tab, setTab] = useState<"stdout" | "stderr">("stdout");

  const showLogs =
    jobStatus !== "PENDING" && jobStatus !== "SUBMITTED";

  const handleLoad = () => {
    if (previewLogs) {
      setStdout(previewLogs.stdout);
      setStderr(previewLogs.stderr);
      setTruncated(previewLogs.truncated);
      setLoaded(true);
      return;
    }
    setError(null);
    setSessionExpired(false);
    startLoad(async () => {
      try {
        const result = await fetchJobLogs(jobId);
        if (!result.ok) {
          if (result.reason === "session_expired") setSessionExpired(true);
          else if (result.reason === "not_found") setError("This job no longer exists.");
          else setError(result.message || "Failed to fetch logs");
          return;
        }
        const data = result.data;
        setStdout(data.stdout);
        setStderr(data.stderr);
        setTruncated(data.truncated);
        setLoaded(true);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to fetch logs");
      }
    });
  };

  if (!showLogs) return null;

  return (
    <Card className="overflow-hidden rounded-xl border-0 gap-0 py-0 shadow-sm">
      <CardHeader className="border-b bg-gradient-to-r from-slate-500/5 to-transparent !py-4 !gap-0 grid-rows-1 items-center">
        <CardTitle className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <div className="flex size-8 items-center justify-center rounded-lg bg-slate-500/10">
            <Terminal className="size-4 text-slate-600" />
          </div>
          Job Logs
        </CardTitle>
      </CardHeader>

      <CardContent className="pt-5 pb-6">
        {!loaded ? (
          <div className="text-center">
            <Button
              variant="outline"
              size="sm"
              onClick={handleLoad}
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="mr-1.5 size-4 animate-spin" />
              ) : (
                <ChevronDown className="mr-1.5 size-4" />
              )}
              Load Logs
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Tabs */}
            <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
              {(["stdout", "stderr"] as const).map((t) => (
                <button
                  key={t}
                  className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    tab === t
                      ? "bg-white text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  onClick={() => setTab(t)}
                >
                  {t === "stdout" ? "Standard Output" : "Standard Error"}
                </button>
              ))}
            </div>

            {truncated && (
              <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-700">
                <AlertTriangle className="size-3.5" />
                Output truncated — showing last 100 KB
              </div>
            )}

            <pre className="max-h-[400px] overflow-auto rounded-lg bg-slate-900 p-4 text-xs leading-relaxed text-slate-200">
              {(tab === "stdout" ? stdout : stderr) || "(empty)"}
            </pre>

            <Button
              variant="ghost"
              size="sm"
              onClick={handleLoad}
              disabled={loading}
            >
              {loading && <Loader2 className="mr-1.5 size-4 animate-spin" />}
              Reload
            </Button>
          </div>
        )}

        {sessionExpired && <SessionExpiredBanner className="mt-3" />}

        {error && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
