import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity, Waves, ArrowRightLeft } from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

export interface NodeSnapshot {
  name: string;
  depth: number;
  head: number;
  inflow: number;
}

export interface LinkSnapshot {
  name: string;
  flow: number;
  depth: number;
  velocity: number;
}

export interface ApiSnapshotEntry {
  stepCount: number;
  elapsedTime: number;
  fileId: string;
  fileName: string;
  nodeSnapshots: NodeSnapshot[];
  linkSnapshots: LinkSnapshot[];
}

export const MAX_SNAPSHOTS_PER_FILE = 500;

interface LiveApiDashboardProps {
  snapshots: ApiSnapshotEntry[];
  currentFileId: string;
}

const CHART_COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
];

function formatElapsed(decimalDays: number): string {
  const totalMinutes = decimalDays * 24 * 60;
  if (totalMinutes < 60) return `${totalMinutes.toFixed(0)}m`;
  const hours = Math.floor(totalMinutes / 60);
  const mins = Math.round(totalMinutes % 60);
  return `${hours}h${mins > 0 ? ` ${mins}m` : ""}`;
}

export default function LiveApiDashboard({ snapshots, currentFileId }: LiveApiDashboardProps) {
  const fileSnapshots = snapshots.filter((s) => s.fileId === currentFileId);

  if (fileSnapshots.length === 0) {
    return (
      <Card data-testid="card-live-api-dashboard">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Activity className="h-4 w-4 text-green-500 animate-pulse" />
            Live API Dashboard
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground" data-testid="text-waiting-snapshots">
            Waiting for API snapshots...
          </p>
        </CardContent>
      </Card>
    );
  }

  const latestSnapshot = fileSnapshots[fileSnapshots.length - 1];
  const nodeNames = latestSnapshot.nodeSnapshots.map((n) => n.name);
  const linkNames = latestSnapshot.linkSnapshots.map((l) => l.name);

  const nodeDepthData = fileSnapshots.map((s) => {
    const point: Record<string, number | string> = { step: s.stepCount };
    s.nodeSnapshots.forEach((n) => {
      point[n.name] = parseFloat(n.depth.toFixed(3));
    });
    return point;
  });

  const linkFlowData = fileSnapshots.map((s) => {
    const point: Record<string, number | string> = { step: s.stepCount };
    s.linkSnapshots.forEach((l) => {
      point[l.name] = parseFloat(l.flow.toFixed(3));
    });
    return point;
  });

  const linkVelocityData = fileSnapshots.map((s) => {
    const point: Record<string, number | string> = { step: s.stepCount };
    s.linkSnapshots.forEach((l) => {
      point[l.name] = parseFloat(l.velocity.toFixed(3));
    });
    return point;
  });

  return (
    <Card data-testid="card-live-api-dashboard">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-sm flex items-center gap-2">
            <Activity className="h-4 w-4 text-green-500 animate-pulse" />
            Live API Dashboard
          </CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className="text-[10px]" data-testid="badge-live-file">
              {latestSnapshot.fileName}
            </Badge>
            <Badge variant="outline" className="text-[10px]" data-testid="badge-live-step">
              Step {latestSnapshot.stepCount.toLocaleString()}
            </Badge>
            <Badge variant="outline" className="text-[10px]" data-testid="badge-live-elapsed">
              {formatElapsed(latestSnapshot.elapsedTime)}
            </Badge>
            <Badge variant="outline" className="text-[10px]" data-testid="badge-live-snapshots">
              {fileSnapshots.length} snapshots
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="space-y-2" data-testid="chart-node-depths">
            <div className="flex items-center gap-1.5">
              <Waves className="h-3.5 w-3.5 text-blue-500" />
              <span className="text-xs font-medium">Node Depths (ft)</span>
            </div>
            <div className="h-40 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={nodeDepthData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis
                    dataKey="step"
                    tick={{ fontSize: 9 }}
                    tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                  />
                  <YAxis tick={{ fontSize: 9 }} width={40} />
                  <Tooltip
                    contentStyle={{ fontSize: 11, borderRadius: 6 }}
                    labelFormatter={(v) => `Step ${Number(v).toLocaleString()}`}
                  />
                  {nodeNames.map((name, i) => (
                    <Line
                      key={name}
                      type="monotone"
                      dataKey={name}
                      stroke={CHART_COLORS[i % CHART_COLORS.length]}
                      strokeWidth={1.5}
                      dot={false}
                      isAnimationActive={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="space-y-2" data-testid="chart-link-flows">
            <div className="flex items-center gap-1.5">
              <ArrowRightLeft className="h-3.5 w-3.5 text-cyan-500" />
              <span className="text-xs font-medium">Link Flows (CFS)</span>
            </div>
            <div className="h-40 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={linkFlowData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis
                    dataKey="step"
                    tick={{ fontSize: 9 }}
                    tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                  />
                  <YAxis tick={{ fontSize: 9 }} width={40} />
                  <Tooltip
                    contentStyle={{ fontSize: 11, borderRadius: 6 }}
                    labelFormatter={(v) => `Step ${Number(v).toLocaleString()}`}
                  />
                  {linkNames.map((name, i) => (
                    <Line
                      key={name}
                      type="monotone"
                      dataKey={name}
                      stroke={CHART_COLORS[i % CHART_COLORS.length]}
                      strokeWidth={1.5}
                      dot={false}
                      isAnimationActive={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        <div className="space-y-2" data-testid="chart-link-velocity">
          <div className="flex items-center gap-1.5">
            <Activity className="h-3.5 w-3.5 text-orange-500" />
            <span className="text-xs font-medium">Link Velocity (ft/s)</span>
          </div>
          <div className="h-36 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={linkVelocityData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                <XAxis
                  dataKey="step"
                  tick={{ fontSize: 9 }}
                  tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                />
                <YAxis tick={{ fontSize: 9 }} width={40} />
                <Tooltip
                  contentStyle={{ fontSize: 11, borderRadius: 6 }}
                  labelFormatter={(v) => `Step ${Number(v).toLocaleString()}`}
                />
                {linkNames.map((name, i) => (
                  <Line
                    key={name}
                    type="monotone"
                    dataKey={name}
                    stroke={CHART_COLORS[i % CHART_COLORS.length]}
                    strokeWidth={1.5}
                    dot={false}
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div data-testid="table-live-nodes">
            <p className="text-[10px] font-medium text-muted-foreground mb-1 uppercase tracking-wider">
              Latest Node Values
            </p>
            <div className="rounded border overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-muted/50">
                    <th className="text-left py-1 px-2 font-medium">Node</th>
                    <th className="text-right py-1 px-2 font-medium">Depth</th>
                    <th className="text-right py-1 px-2 font-medium">Head</th>
                    <th className="text-right py-1 px-2 font-medium">Inflow</th>
                  </tr>
                </thead>
                <tbody>
                  {latestSnapshot.nodeSnapshots.map((n) => (
                    <tr key={n.name} className="border-t border-border/50">
                      <td className="py-1 px-2 font-mono">{n.name}</td>
                      <td className="py-1 px-2 text-right font-mono">{n.depth.toFixed(2)}</td>
                      <td className="py-1 px-2 text-right font-mono">{n.head.toFixed(2)}</td>
                      <td className="py-1 px-2 text-right font-mono">{n.inflow.toFixed(3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div data-testid="table-live-links">
            <p className="text-[10px] font-medium text-muted-foreground mb-1 uppercase tracking-wider">
              Latest Link Values
            </p>
            <div className="rounded border overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-muted/50">
                    <th className="text-left py-1 px-2 font-medium">Link</th>
                    <th className="text-right py-1 px-2 font-medium">Flow</th>
                    <th className="text-right py-1 px-2 font-medium">Depth</th>
                    <th className="text-right py-1 px-2 font-medium">Velocity</th>
                  </tr>
                </thead>
                <tbody>
                  {latestSnapshot.linkSnapshots.map((l) => (
                    <tr key={l.name} className="border-t border-border/50">
                      <td className="py-1 px-2 font-mono">{l.name}</td>
                      <td className="py-1 px-2 text-right font-mono">{l.flow.toFixed(3)}</td>
                      <td className="py-1 px-2 text-right font-mono">{l.depth.toFixed(2)}</td>
                      <td className="py-1 px-2 text-right font-mono">{l.velocity.toFixed(3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
