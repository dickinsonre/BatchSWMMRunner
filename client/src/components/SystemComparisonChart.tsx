import { useState, useMemo, useEffect } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer, Brush,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, LineChart as LineChartIcon } from "lucide-react";
import { parseTimeSeries, type ParsedTimeSeries } from "@/lib/parseTimeSeries";
import { mergeSystemSeries, type EngineRun } from "@/lib/engineComparison";

const ENGINE_COLORS = [
  "hsl(210, 85%, 50%)",
  "hsl(340, 75%, 50%)",
  "hsl(142, 60%, 40%)",
  "hsl(35, 90%, 50%)",
];

interface SystemComparisonChartProps {
  runs: EngineRun[];
  /** Ask the parent to fetch report content for this file across all runs. */
  onLoadFile: (fileName: string) => Promise<void>;
}

/** Pull the system-wide time series out of one run's report for a file. */
function systemSeriesFor(run: EngineRun, fileName: string): ParsedTimeSeries | null {
  const result = run.results.find(r => r.fileName === fileName);
  const content = (result as any)?.reportContent as string | undefined;
  if (!content) return null;
  const all = parseTimeSeries(content);
  return all.find(ts => /system/i.test(ts.title)) || null;
}

export default function SystemComparisonChart({ runs, onLoadFile }: SystemComparisonChartProps) {
  // Files that succeeded in at least two runs are comparable.
  const fileNames = useMemo(() => {
    const counts = new Map<string, number>();
    for (const run of runs) {
      for (const r of run.results) {
        if (r.status === 'success') counts.set(r.fileName, (counts.get(r.fileName) || 0) + 1);
      }
    }
    return Array.from(counts.entries()).filter(([, n]) => n >= 2).map(([name]) => name);
  }, [runs]);

  const [fileName, setFileName] = useState<string>(fileNames[0] || '');
  const [metric, setMetric] = useState<string>('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!fileName && fileNames.length > 0) setFileName(fileNames[0]);
  }, [fileNames, fileName]);

  // Make sure report content for the chosen file is loaded in every run.
  useEffect(() => {
    if (!fileName) return;
    let stale = false;
    setLoading(true);
    onLoadFile(fileName).finally(() => { if (!stale) setLoading(false); });
    return () => { stale = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileName]);

  const perEngine = useMemo(
    () => runs.map(run => ({ label: run.label, series: systemSeriesFor(run, fileName) })),
    [runs, fileName],
  );

  const withData = perEngine.filter(e => e.series);

  // Metrics available: union of columns, skipping ones that are all-zero everywhere.
  const metrics = useMemo(() => {
    const seen = new Map<string, string>(); // name -> unit
    for (const e of withData) {
      const s = e.series!;
      s.columns.forEach((col, ci) => {
        const allZero = s.data.every(d => (d.values[ci] ?? 0) === 0);
        if (!allZero && !seen.has(col)) seen.set(col, s.units[ci] || '');
      });
    }
    return Array.from(seen.entries()).map(([name, unit]) => ({ name, unit }));
  }, [withData]);

  useEffect(() => {
    if (metrics.length > 0 && !metrics.some(m => m.name === metric)) {
      // Prefer a flow-like metric as the default.
      const preferred = metrics.find(m => /outflow|runoff|inflow/i.test(m.name)) || metrics[0];
      setMetric(preferred.name);
    }
  }, [metrics, metric]);

  // Merge every engine's values onto one chronologically sorted time axis.
  const chartData = useMemo(
    () => (metric ? mergeSystemSeries(withData, metric) : []),
    [withData, metric],
  );

  if (fileNames.length === 0) return null;
  const metricUnit = metrics.find(m => m.name === metric)?.unit || '';

  return (
    <Card data-testid="card-system-comparison">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <LineChartIcon className="h-5 w-5" />
          System Graphs — Engine Overlay
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          System-wide results from each engine drawn on one chart. Lines that sit on top of each other mean the engines agree.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Select value={fileName} onValueChange={setFileName}>
            <SelectTrigger className="w-[280px]" data-testid="select-system-comparison-file">
              <SelectValue placeholder="Choose a model" />
            </SelectTrigger>
            <SelectContent>
              {fileNames.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={metric} onValueChange={setMetric} disabled={metrics.length === 0}>
            <SelectTrigger className="w-[240px]" data-testid="select-system-comparison-metric">
              <SelectValue placeholder="Choose a metric" />
            </SelectTrigger>
            <SelectContent>
              {metrics.map(m => (
                <SelectItem key={m.name} value={m.name}>
                  {m.name}{m.unit ? ` (${m.unit})` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {loading && <Loader2 className="h-5 w-5 animate-spin self-center text-muted-foreground" />}
        </div>

        {!loading && withData.length < 2 && (
          <p className="text-xs text-muted-foreground" data-testid="text-system-comparison-unavailable">
            System time series are available for {withData.length} of {runs.length} engines for this model.
            {withData.length === 0 ? ' Older results may need to be re-run to include system data.' : ' At least two are needed for an overlay.'}
          </p>
        )}

        {chartData.length > 0 && withData.length >= 1 && (
          <div className="h-[320px]" data-testid="chart-system-comparison">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="time" tick={{ fontSize: 10 }} minTickGap={48} />
                <YAxis tick={{ fontSize: 10 }} width={70}
                  label={metricUnit ? { value: metricUnit, angle: -90, position: 'insideLeft', style: { fontSize: 10 } } : undefined} />
                <Tooltip contentStyle={{ fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {withData.map((e, i) => (
                  <Line
                    key={e.label}
                    type="monotone"
                    dataKey={e.label}
                    stroke={ENGINE_COLORS[i % ENGINE_COLORS.length]}
                    dot={false}
                    strokeWidth={1.75}
                  />
                ))}
                {chartData.length > 100 && <Brush dataKey="time" height={20} travellerWidth={8} />}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
