import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AdminPage } from "@/components/admin/admin-page";
import { InlineError } from "@/components/admin/admin-states";
import { AnvilScratchCard } from "@/components/admin/anvil-scratch-card";
import { StatCard } from "@/components/admin/site-stats-cards";
import { fetchSystemInfo } from "@/lib/admin/actions";
import type { DependencyStatus } from "@/lib/admin/types";

export const metadata: Metadata = { title: "System | OpenGHM Admin" };

const STATUS_STYLE: Record<DependencyStatus, string> = {
  ok: "bg-success/10 text-success border-success/25",
  degraded: "bg-warning/10 text-warning border-warning/25",
  unconfigured: "bg-muted text-muted-foreground border-border",
  error: "bg-destructive/10 text-destructive border-destructive/25",
};

const STATUS_LABEL: Record<DependencyStatus, string> = {
  ok: "OK",
  degraded: "Degraded",
  unconfigured: "Not configured",
  error: "Error",
};

const SYSTEM_DESCRIPTION = "How the gateway is running, and what the spool cache holds on Anvil scratch.";

function formatUptime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export default async function AdminSystemPage() {
  // The backend answers only an admin (Permission.SYSTEM_VIEW); a staff member
  // who types the address would otherwise read "Couldn't load", as if it broke.
  // Defence in depth, like the Community and Home layouts: not the real gate.
  const session = await auth();
  if (session?.user.role !== "admin") {
    return (
      <AdminPage title="System" description={SYSTEM_DESCRIPTION}>
        <InlineError title="This page is for administrators.">
          Ask an admin for the information, or to give your account the admin role.
        </InlineError>
      </AdminPage>
    );
  }

  const info = await fetchSystemInfo();

  if (!info) {
    return (
      <AdminPage title="System" description={SYSTEM_DESCRIPTION}>
        <InlineError title="Couldn't load the system information." />
        <AnvilScratchCard />
      </AdminPage>
    );
  }

  return (
    <AdminPage title="System" description={SYSTEM_DESCRIPTION}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Environment" value={info.environment} valueClass="text-lg capitalize" />
        <StatCard label="Version" value={info.version} valueClass="text-lg" />
        <StatCard label="Uptime" value={formatUptime(info.uptime_seconds)} valueClass="text-lg" />
        <StatCard label="Server time" value={`${new Date(info.server_time).toISOString().slice(11, 19)} UTC`} valueClass="text-lg" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Dependencies</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {info.dependencies.map((dep) => (
            <div key={dep.name} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-xl border border-border px-3.5 py-2.5">
              <div className="min-w-0">
                <p className="text-sm font-medium capitalize text-foreground">{dep.name}</p>
                {dep.detail && <p className="text-xs break-words text-muted-foreground">{dep.detail}</p>}
              </div>
              <div className="flex items-center gap-3">
                {dep.latency_ms !== null && (
                  <span className="text-xs text-muted-foreground">{dep.latency_ms}ms</span>
                )}
                <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLE[dep.status]}`}>
                  {STATUS_LABEL[dep.status] ?? dep.status}
                </span>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <AnvilScratchCard />

      <Card>
        <CardHeader>
          <CardTitle>Features</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {info.features.map((f) => (
            <div key={f.name} className="flex items-start justify-between gap-3 rounded-xl border border-border px-3.5 py-2.5">
              <div className="min-w-0">
                <p className="text-sm font-medium capitalize text-foreground">{f.name.replace(/_/g, " ")}</p>
                {f.note && <p className="text-xs text-muted-foreground">{f.note}</p>}
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
              <div key={key} className="flex items-center justify-between gap-3 border-b border-border/60 py-1.5">
                <dt className="text-muted-foreground">{key.replace(/_/g, " ")}</dt>
                <dd className="min-w-0 break-words text-right font-medium text-foreground">
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
