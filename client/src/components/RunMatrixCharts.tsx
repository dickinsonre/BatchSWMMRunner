import { useEffect, useMemo, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { TrendingUp } from "lucide-react";
import type { ProcessResult } from "@shared/schema";
import type { MatrixVariant } from "@shared/inpOptions";
import { buildMatrixPoints, type MatrixPoint } from "@/lib/runMatrix";

const SERIES_COLORS = [
  "hsl(220 70% 50%)",
  "hsl(0 72% 51%)",
  "hsl(142 71% 45%)",
  "hsl(38 92% 50%)",
  "hsl(280 65% 60%)",
  "hsl(190 80% 40%)",
];

interface RunMatrixChartsProps {
  results: ProcessResult[];
  variants: MatrixVariant[];
  /** Loads full report text for every result (needed for peak flow). */
  onLoadAllContent?: () => Promise<unknown>;
}

function MetricChart({
  title,
  unit,
  points,
  metric,
  emptyHint,
}: {
  title: string;
  unit: string;
  points: MatrixPoint[];
  metric: (p: MatrixPoint) => number | undefined;
  emptyHint: string;
}) {
  const seriesNames = Array.from(new Set(points.map(p => p.series)));
  // One row per routing step; one column per series.
  const steps = Array.from(new Set(points.map(p => p.routingStep))).sort((a, b) => a - b);
  const data = steps.map(rs => {
    const row: Record<string, number | undefined> = { routingStep: rs };
    for (const p of points) {
      if (p.routingStep === rs) {
        const v = metric(p);
        if (v !== undefined) row[p.series] = v;
      }
    }
    return row;
  });
  const hasData = data.some(row => seriesNames.some(s => row[s] !== undefined));

  return (
    <div className="space-y-1" data-testid={`chart-matrix-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}>
      <p className="text-sm font-medium">{title}</p>
      {hasData ? (
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis
              dataKey="routingStep"
              type="number"
              domain={['dataMin', 'dataMax']}
              tickFormatter={(v) => `${v}s`}
              label={{ value: 'Routing step (s)', position: 'insideBottom', offset: -4, fontSize: 11 }}
              fontSize={11}
            />
            <YAxis fontSize={11} width={60} tickFormatter={(v) => `${v}`} />
            <Tooltip
              formatter={(value: number, name: string) => [`${Number(value).toPrecision(4)} ${unit}`, name]}
              labelFormatter={(v) => `Routing step: ${v}s`}
            />
            {seriesNames.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
            {seriesNames.map((s, i) => (
              <Line
                key={s}
                dataKey={s}
                name={s}
                type="monotone"
                stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
                strokeWidth={2}
                dot={{ r: 3 }}
                connectNulls
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <p className="text-sm text-muted-foreground">{emptyHint}</p>
      )}
    </div>
  );
}

export default function RunMatrixCharts({ results, variants, onLoadAllContent }: RunMatrixChartsProps) {
  // Peak flow lives in the .rpt Link Flow Summary, which is fetched lazily
  // for server runs — load all report text once when the charts mount.
  const loadedRef = useRef(false);
  useEffect(() => {
    if (loadedRef.current || !onLoadAllContent) return;
    loadedRef.current = true;
    onLoadAllContent().catch(() => { /* charts simply omit peak flow */ });
  }, [onLoadAllContent]);

  const points = useMemo(() => buildMatrixPoints(results, variants), [results, variants]);
  const okPoints = points.filter(p => p.status === 'success');
  const failed = points.filter(p => p.status !== 'success');

  return (
    <Card data-testid="card-run-matrix-charts">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-primary" />
          Run Matrix — accuracy vs speed
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {okPoints.length} of {points.length} variant runs succeeded.
          {failed.length > 0 && ` Failed: ${failed.map(f => f.label).join(', ')}.`}
        </p>
      </CardHeader>
      <CardContent className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <MetricChart
          title="Flow routing continuity error"
          unit="%"
          points={okPoints}
          metric={(p) => p.routingCE}
          emptyHint="No routing continuity error was reported by these runs."
        />
        <MetricChart
          title="Runtime"
          unit="s"
          points={okPoints}
          metric={(p) => p.runtimeSeconds}
          emptyHint="No runtime data available."
        />
        <MetricChart
          title="Peak flow (largest link max |flow|)"
          unit=""
          points={okPoints}
          metric={(p) => p.peakFlow}
          emptyHint="Peak flow needs the full report text — it loads automatically; re-open this tab if empty."
        />
        <MetricChart
          title="Runoff continuity error"
          unit="%"
          points={okPoints}
          metric={(p) => p.runoffCE}
          emptyHint="No runoff continuity error was reported by these runs."
        />
      </CardContent>
    </Card>
  );
}
