import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AdminPage, InlineError } from "@/components/admin/admin-page";
import { SectionHeader } from "@/components/admin/section-header";
import { fetchSystemInfo } from "@/lib/admin/actions";
import type { DependencyStatus } from "@/lib/admin/types";

const STATUS_STYLE: Record<DependencyStatus, string> = {
  ok: "bg-success/10 text-success border-success/25",
  degraded: "bg-warning/10 text-warning border-warning/25",
  unconfigured: "bg-slate-100 text-slate-600 border-slate-200",
  error: "bg-destructive/10 text-destructive border-destructive/25",
};

const STATUS_LABEL: Record<DependencyStatus, string> = {
  ok: "OK",
  degraded: "Degraded",
  unconfigured: "Not configured",
  error: "Error",
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
      <AdminPage>
        <SectionHeader title="System" description="How the gateway is running. Read-only." />
        <InlineError title="Couldn't load the system information." />
      </AdminPage>
    );
  }

  return (
    <AdminPage>
      <SectionHeader title="System" description="How the gateway is running. Read-only." />

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
            <div key={dep.name} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md border border-slate-100 px-3 py-2">
              <div className="min-w-0">
                <p className="text-sm font-medium capitalize text-slate-900">{dep.name}</p>
                {dep.detail && <p className="text-xs break-words text-slate-500">{dep.detail}</p>}
              </div>
              <div className="flex items-center gap-3">
                {dep.latency_ms !== null && (
                  <span className="text-xs text-slate-500">{dep.latency_ms}ms</span>
                )}
                <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLE[dep.status]}`}>
                  {STATUS_LABEL[dep.status] ?? dep.status}
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
              <div className="min-w-0">
                <p className="text-sm font-medium capitalize text-slate-900">{f.name.replace(/_/g, " ")}</p>
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
              <div key={key} className="flex items-center justify-between gap-3 border-b border-slate-50 py-1">
                <dt className="text-slate-500">{key.replace(/_/g, " ")}</dt>
                <dd className="min-w-0 break-words text-right font-medium text-slate-900">
                  {Array.isArray(value) ? value.join(", ") || "—" : String(value)}
                </dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
    </AdminPage>
  );
}
