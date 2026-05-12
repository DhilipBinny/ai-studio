"use client";
import { RequirePermission } from "@/components/require-permission";

import { useState, useEffect } from "react";
import { Bot, Wrench, Play, GitBranch, TrendingUp, CheckCircle } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/page-header";

interface Stats {
  agents: number;
  tools: number;
  knowledgeBases: number;
  connectors: number;
  workflows: number;
  totalRuns: number;
  runsToday: number;
  successRate: number;
}

interface Activity {
  id: number;
  action: string;
  resourceType: string | null;
  createdAt: string;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [activity, setActivity] = useState<Activity[]>([]);

  useEffect(() => {
    fetch("/api/dashboard/stats").then((r) => r.ok ? r.json() : null).then(setStats);
    fetch("/api/dashboard/activity").then((r) => r.ok ? r.json() : null).then((d) => setActivity(d?.data || []));
  }, []);

  const statCards = [
    { label: "Agents", value: stats?.agents, icon: Bot },
    { label: "Tools", value: stats?.tools, icon: Wrench },
    { label: "Runs Today", value: stats?.runsToday, icon: Play },
    { label: "Success Rate", value: stats ? `${stats.successRate}%` : undefined, icon: CheckCircle },
  ];

  return (
    <RequirePermission module="DASHBOARD"><>
      <PageHeader title="Dashboard" description="Overview of your AI agents, runs, and usage metrics." />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {statCards.map((card) => (
          <Card key={card.label}>
            <CardContent className="p-6">
              <div className="flex items-center gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-secondary">
                  <card.icon className="h-5 w-5 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{card.label}</p>
                  {card.value !== undefined ? (
                    <p className="text-2xl font-semibold tracking-tight">{card.value}</p>
                  ) : (
                    <Skeleton className="mt-1 h-7 w-16" />
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent Activity</CardTitle>
          </CardHeader>
          <CardContent>
            {activity.length === 0 ? (
              <p className="text-sm text-muted-foreground">No activity yet.</p>
            ) : (
              <div className="space-y-3">
                {activity.slice(0, 10).map((a) => (
                  <div key={a.id} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{a.action}</span>
                      {a.resourceType && <Badge variant="secondary">{a.resourceType}</Badge>}
                    </div>
                    <span className="text-xs text-muted-foreground">{new Date(a.createdAt).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Platform Summary</CardTitle>
          </CardHeader>
          <CardContent>
            {stats ? (
              <div className="space-y-3">
                {[
                  { label: "Knowledge Bases", value: stats.knowledgeBases },
                  { label: "Connectors", value: stats.connectors },
                  { label: "Workflows", value: stats.workflows },
                  { label: "Total Runs", value: stats.totalRuns },
                ].map((item) => (
                  <div key={item.label} className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{item.label}</span>
                    <span className="font-medium">{item.value}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-5 w-full" />)}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </></RequirePermission>
  );
}
