import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SectionHeader } from "@/components/admin/section-header";
import { fetchSystemInfo } from "@/lib/admin/actions";
import type { DependencyStatus } from "@/lib/admin/types";

const STATUS_STYLE: Record<DependencyStatus, string> = {
  ok: "bg-emerald-50 text-emerald-700 border-emerald-200",
  degraded: "bg-amber-50 text-amber-700 border-amber-200",
  unconfigured: "bg-slate-100 text-slate-500 border-slate-200",
  error: "bg-red-50 text-red-700 border-red-200",
};

function formatUptime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export default async function AdminSystemPage() {
  const info = await fetchSystemInfo();

  if (!info) {
    return (
      <div className="mx-auto max-w-6xl space-y-6 p-8">
        <SectionHeader title="System" description="Read-only status — no config editing here." />
        <p className="text-sm text-red-600">Failed to load system information.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-8">
      <SectionHeader title="System" description="Read-only status — no config editing here." />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card>
          <CardContent className="py-4">
            <p className="text-lg font-bold text-slate-900 capitalize">{info.environment}</p>
            <p className="text-sm text-slate-500">Environment</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-lg font-bold text-slate-900">{info.version}</p>
            <p className="text-sm text-slate-500">Version</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-lg font-bold text-slate-900">{formatUptime(info.uptime_seconds)}</p>
            <p className="text-sm text-slate-500">Uptime</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-lg font-bold text-slate-900">
              {new Date(info.server_time).toISOString().slice(11, 19)} UTC
            </p>
            <p className="text-sm text-slate-500">Server time</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Dependencies</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {info.dependencies.map((dep) => (
            <div key={dep.name} className="flex items-center justify-between rounded-md border border-slate-100 px-3 py-2">
              <div>
                <p className="text-sm font-medium capitalize text-slate-900">{dep.name}</p>
                {dep.detail && <p className="text-xs text-slate-500">{dep.detail}</p>}
              </div>
              <div className="flex items-center gap-3">
                {dep.latency_ms !== null && (
                  <span className="text-xs text-slate-400">{dep.latency_ms}ms</span>
                )}
                <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold capitalize ${STATUS_STYLE[dep.status]}`}>
                  {dep.status}
                </span>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Features</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {info.features.map((f) => (
            <div key={f.name} className="flex items-start justify-between gap-3 rounded-md border border-slate-100 px-3 py-2">
              <div>
                <p className="text-sm font-medium capitalize text-slate-900">{f.name.replace("_", " ")}</p>
                {f.note && <p className="text-xs text-slate-500">{f.note}</p>}
              </div>
              <Badge variant={f.configured ? "secondary" : "outline"} className="shrink-0">
                {f.configured ? "Configured" : "Not configured"}
              </Badge>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Runtime settings</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
            {Object.entries(info.settings).map(([key, value]) => (
              <div key={key} className="flex items-center justify-between border-b border-slate-50 py-1">
                <dt className="text-slate-500">{key.replace(/_/g, " ")}</dt>
                <dd className="font-medium text-slate-900">
                  {Array.isArray(value) ? value.join(", ") || "—" : String(value)}
                </dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
