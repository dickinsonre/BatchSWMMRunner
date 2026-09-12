import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  Brush,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartNoAxesCombined, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { parseTimeSeries } from "@/lib/parseTimeSeries";
import {
  buildComparisonModelOptions,
  commonEntityMetrics,
  formatElapsedTime,
  indexEntitySeries,
  mergeEntityMetric,
  type EntitySeriesKind,
} from "@/lib/entityComparison";
import type { EngineRun } from "@/lib/engineComparison";

const ENGINE_COLORS = [
  "hsl(210, 85%, 50%)",
  "hsl(340, 75%, 50%)",
  "hsl(142, 60%, 40%)",
  "hsl(35, 90%, 50%)",
];

const KIND_LABELS: Record<EntitySeriesKind, string> = {
  node: "Node",
  link: "Link",
  subcatchment: "Subcatchment",
};

const KIND_REPORT_KEYS: Record<EntitySeriesKind, string> = {
  node: "NODES ALL",
  link: "LINKS ALL",
  subcatchment: "SUBCATCHMENTS ALL",
};

interface EntityComparisonChartProps {
  runs: EngineRun[];
  onLoadFile: (fileName: string, occurrence?: number) => Promise<void>;
}

export default function EntityComparisonChart({ runs, onLoadFile }: EntityComparisonChartProps) {
  const models = useMemo(() => buildComparisonModelOptions(runs), [runs]);
  const [modelKey, setModelKey] = useState(models[0]?.key ?? "");
  const [kind, setKind] = useState<EntitySeriesKind>("node");
  const [element, setElement] = useState("");
  const [metric, setMetric] = useState("");
  const [loading, setLoading] = useState(false);
  const selectedModel = models.find(model => model.key === modelKey) ?? null;

  useEffect(() => {
    if (models.length > 0 && !models.some(model => model.key === modelKey)) {
      setModelKey(models[0].key);
    }
  }, [models, modelKey]);

  useEffect(() => {
    if (!selectedModel) return;
    let stale = false;
    setLoading(true);
    onLoadFile(selectedModel.fileName, selectedModel.occurrence).finally(() => {
      if (!stale) setLoading(false);
    });
    return () => {
      stale = true;
    };
    // Loading is intentionally keyed only by the selected file.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelKey]);

  const indexedByEngine = useMemo(
    () => runs.map((run, index) => {
      const result = selectedModel?.results[index];
      const report = result?.reportContent;
      return {
        label: run.label,
        index: indexEntitySeries(report ? parseTimeSeries(report) : []),
      };
    }),
    [runs, selectedModel],
  );

  const availableKinds = useMemo(() => (
    (["node", "link", "subcatchment"] as EntitySeriesKind[]).filter(candidate =>
      indexedByEngine.reduce(
        (count, entry) => count + (entry.index[candidate].size > 0 ? 1 : 0),
        0,
      ) >= 2
    )
  ), [indexedByEngine]);

  useEffect(() => {
    if (availableKinds.length > 0 && !availableKinds.includes(kind)) {
      setKind(availableKinds[0]);
    }
  }, [availableKinds, kind]);

  const elements = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of indexedByEngine) {
      for (const name of entry.index[kind].keys()) {
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .filter(([, count]) => count >= 2)
      .map(([name]) => name)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [indexedByEngine, kind]);

  useEffect(() => {
    if (elements.length > 0 && !elements.includes(element)) {
      setElement(elements[0]);
    } else if (elements.length === 0 && element) {
      setElement("");
    }
  }, [elements, element]);

  const perEngine = useMemo(
    () => indexedByEngine.map(entry => ({
      label: entry.label,
      series: element ? entry.index[kind].get(element) ?? null : null,
    })),
    [indexedByEngine, kind, element],
  );
  const withData = perEngine.filter(entry => entry.series);

  const metrics = useMemo(
    () => commonEntityMetrics(withData.map(entry => entry.series!)),
    [withData],
  );

  useEffect(() => {
    if (metrics.length > 0 && !metrics.some(item => item.name === metric)) {
      setMetric(metrics[0].name);
    } else if (metrics.length === 0 && metric) {
      setMetric("");
    }
  }, [metrics, metric]);

  const chartData = useMemo(
    () => metric ? mergeEntityMetric(perEngine, metric) : [],
    [perEngine, metric],
  );
  const metricUnit = metrics.find(item => item.name === metric)?.unit ?? "";
  const rainfallMetric = /rainfall/i.test(metric);
  const missingEngineLabels = perEngine
    .filter(entry => !entry.series)
    .map(entry => entry.label);

  if (models.length === 0) return null;

  return (
    <Card data-testid="card-entity-comparison">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ChartNoAxesCombined className="h-5 w-5" />
          Element Graphs — Engine Overlay
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Compare node, link, and subcatchment results across engines. Each engine is aligned to its own simulation start time.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Select value={modelKey} onValueChange={setModelKey}>
            <SelectTrigger className="w-[260px]" data-testid="select-entity-comparison-file">
              <SelectValue placeholder="Choose a model" />
            </SelectTrigger>
            <SelectContent>
              {models.map(model => (
                <SelectItem key={model.key} value={model.key}>{model.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={availableKinds.includes(kind) ? kind : ""}
            onValueChange={value => setKind(value as EntitySeriesKind)}
            disabled={availableKinds.length === 0}
          >
            <SelectTrigger className="w-[170px]" data-testid="select-entity-comparison-kind">
              <SelectValue placeholder="Element type" />
            </SelectTrigger>
            <SelectContent>
              {availableKinds.map(value => (
                <SelectItem key={value} value={value}>{KIND_LABELS[value]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={element} onValueChange={setElement} disabled={elements.length === 0}>
            <SelectTrigger className="w-[220px]" data-testid="select-entity-comparison-element">
              <SelectValue placeholder={`Choose ${KIND_LABELS[kind].toLowerCase()}`} />
            </SelectTrigger>
            <SelectContent>
              {elements.map(name => <SelectItem key={name} value={name}>{name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={metric} onValueChange={setMetric} disabled={metrics.length === 0}>
            <SelectTrigger className="w-[240px]" data-testid="select-entity-comparison-metric">
              <SelectValue placeholder="Choose a metric" />
            </SelectTrigger>
            <SelectContent>
              {metrics.map(item => (
                <SelectItem key={item.name} value={item.name}>
                  {item.name}{item.unit ? ` (${item.unit})` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {loading && <Loader2 className="h-5 w-5 animate-spin self-center text-muted-foreground" />}
        </div>

        {!loading && availableKinds.length === 0 && (
          <p className="text-xs text-muted-foreground" data-testid="text-entity-comparison-unavailable">
            No common node, link, or subcatchment time series were found for this model. Add
            {' '}<code>[REPORT]</code> entries such as <code>NODES ALL</code>, <code>LINKS ALL</code>,
            or <code>SUBCATCHMENTS ALL</code>, then run the comparison again.
          </p>
        )}

        {!loading && availableKinds.includes(kind) && elements.length === 0 && (
          <p className="text-xs text-muted-foreground" data-testid="text-entity-comparison-kind-unavailable">
            No {KIND_LABELS[kind].toLowerCase()} appears in at least two engine reports. Confirm
            {' '}<code>{KIND_REPORT_KEYS[kind]}</code> is enabled in the model&apos;s <code>[REPORT]</code> section.
          </p>
        )}

        {!loading && element && missingEngineLabels.length > 0 && (
          <p className="text-xs text-amber-600 dark:text-amber-400" data-testid="text-entity-comparison-missing-engines">
            {KIND_LABELS[kind]} {element} is not shown for {missingEngineLabels.join(", ")} because
            those engine reports do not contain its time series. Confirm
            {' '}<code>{KIND_REPORT_KEYS[kind]}</code> is enabled, then rerun those engines.
          </p>
        )}

        {!loading && element && withData.length >= 2 && metrics.length === 0 && (
          <p className="text-xs text-muted-foreground" data-testid="text-entity-comparison-no-common-metrics">
            No common metrics were found for {KIND_LABELS[kind].toLowerCase()} {element} across
            the available engine reports.
          </p>
        )}

        {chartData.length > 0 && withData.length >= 2 && (
          <div className="h-[340px]" data-testid="chart-entity-comparison">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis
                  dataKey="elapsedSeconds"
                  type="number"
                  domain={["dataMin", "dataMax"]}
                  tick={{ fontSize: 10 }}
                  minTickGap={48}
                  tickFormatter={value => formatElapsedTime(Number(value))}
                  label={{ value: "Elapsed simulation time", position: "insideBottom", offset: -2, style: { fontSize: 10 } }}
                  height={45}
                />
                <YAxis
                  tick={{ fontSize: 10 }}
                  width={70}
                  label={metricUnit
                    ? { value: metricUnit, angle: -90, position: "insideLeft", style: { fontSize: 10 } }
                    : undefined}
                />
                <Tooltip
                  contentStyle={{ fontSize: 12 }}
                  labelFormatter={value => `Elapsed: ${formatElapsedTime(Number(value))}`}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {rainfallMetric
                  ? withData.map((entry, index) => (
                      <Bar
                        key={entry.label}
                        dataKey={entry.label}
                        fill={ENGINE_COLORS[index % ENGINE_COLORS.length]}
                        maxBarSize={14}
                        radius={[2, 2, 0, 0]}
                        isAnimationActive={false}
                      />
                    ))
                  : withData.map((entry, index) => (
                      <Line
                        key={entry.label}
                        type="monotone"
                        dataKey={entry.label}
                        stroke={ENGINE_COLORS[index % ENGINE_COLORS.length]}
                        dot={false}
                        strokeWidth={1.75}
                        connectNulls={false}
                      />
                    ))}
                {chartData.length > 100 && (
                  <Brush
                    dataKey="elapsedSeconds"
                    height={20}
                    travellerWidth={8}
                    tickFormatter={value => formatElapsedTime(Number(value))}
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}