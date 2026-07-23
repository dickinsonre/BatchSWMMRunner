import { useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GitCompareArrows } from "lucide-react";
import type { ParsedMetrics } from "@shared/schema";

interface ComparisonResult {
  id: string;
  fileName: string;
  status: string;
  processingTime?: number;
  results?: { peakFlow?: number; totalVolume?: number };
  parsedMetrics?: ParsedMetrics;
}

interface MetricSpec {
  key: string;
  title: string;
  unit: string;
  getValue: (r: ComparisonResult) => number | undefined;
}

const METRICS: MetricSpec[] = [
  { key: "peakFlow", title: "Peak Flow", unit: "CFS", getValue: r => r.results?.peakFlow },
  { key: "totalVolume", title: "Total Volume", unit: "MG", getValue: r => r.results?.totalVolume },
  { key: "runoffCE", title: "Runoff Continuity Error", unit: "%", getValue: r => r.parsedMetrics?.runoffContinuityError },
  { key: "routingCE", title: "Routing Continuity Error", unit: "%", getValue: r => r.parsedMetrics?.routingContinuityError },
  { key: "nodesFlooded", title: "Nodes Flooded", unit: "", getValue: r => r.parsedMetrics?.nodesFlooded },
  { key: "time", title: "Processing Time", unit: "s", getValue: r => r.processingTime },
];

const NORMAL_COLOR = "hsl(210, 85%, 50%)";
const OUTLIER_COLOR = "hsl(0, 75%, 50%)";

function shortName(name: string): string {
  const base = name.replace(/\.inp$/i, "");
  return base.length > 14 ? base.slice(0, 12) + "…" : base;
}

export default function BatchComparison({ results }: { results: ComparisonResult[] }) {
  const charts = useMemo(() => {
    const successful = results.filter(r => r.status === "success");
    if (successful.length < 2) return [];

    return METRICS.map(metric => {
      const data = successful
        .map(r => ({ name: shortName(r.fileName), fullName: r.fileName, value: metric.getValue(r) }))
        .filter((d): d is { name: string; fullName: string; value: number } => typeof d.value === "number" && isFinite(d.value));
      if (data.length < 2) return null;

      const values = data.map(d => Math.abs(d.value));
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      const std = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
      const withOutliers = data.map(d => ({
        ...d,
        isOutlier: std > 0 && Math.abs(Math.abs(d.value) - mean) > 2 * std,
      }));

      return { ...metric, data: withOutliers, hasOutliers: withOutliers.some(d => d.isOutlier) };
    }).filter((c): c is NonNullable<typeof c> => c !== null);
  }, [results]);

  if (charts.length === 0) return null;

  return (
    <Card data-testid="card-batch-comparison">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <GitCompareArrows className="h-4 w-4" />
          Batch Comparison
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Key metrics across all successful files. Bars in red are outliers (more than 2 standard deviations from the batch average) — worth a closer look.
        </p>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {charts.map(chart => (
            <div key={chart.key} data-testid={`comparison-chart-${chart.key}`}>
              <p className="text-sm font-medium mb-1">
                {chart.title}{chart.unit ? ` (${chart.unit})` : ""}
              </p>
              <div style={{ width: "100%", height: 200 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chart.data} margin={{ top: 5, right: 10, bottom: 35, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis
                      dataKey="name"
                      angle={-45}
                      textAnchor="end"
                      interval={0}
                      height={55}
                      tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                    />
                    <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                    <Tooltip
                      formatter={(value: number) => [value, chart.title]}
                      labelFormatter={(_, payload) => payload?.[0]?.payload?.fullName ?? ""}
                      contentStyle={{
                        background: "hsl(var(--popover))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: 6,
                        fontSize: 12,
                      }}
                    />
                    <Bar dataKey="value">
                      {chart.data.map((d, i) => (
                        <Cell key={i} fill={d.isOutlier ? OUTLIER_COLOR : NORMAL_COLOR} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
