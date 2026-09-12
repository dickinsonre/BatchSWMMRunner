import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Orbit, Loader2 } from "lucide-react";
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
  type EntitySeriesKind,
} from "@/lib/entityComparison";
import {
  buildDerivativePhasePoints,
  buildRatingPhasePoints,
  phaseExclusionReason,
  phaseMetricDefaults,
  phaseRange,
  type PhaseSpaceMode,
} from "@/lib/phaseSpaceComparison";
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

interface PhaseSpaceComparisonProps {
  runs: EngineRun[];
  onLoadFile: (fileName: string, occurrence?: number) => Promise<void>;
}

function phaseSegments(points: Array<{ segment: number }>) {
  const grouped = new Map<number, typeof points>();
  for (const point of points) {
    const segment = grouped.get(point.segment) ?? [];
    segment.push(point);
    grouped.set(point.segment, segment);
  }
  return Array.from(grouped.values());
}

function PhaseTooltip({ active, payload }: {
  active?: boolean;
  payload?: Array<{
    name?: string;
    payload?: { x?: number; y?: number; elapsedSeconds?: number };
  }>;
}) {
  const item = payload?.[0];
  const point = item?.payload;
  if (!active || !point) return null;
  return (
    <div className="rounded-md border bg-popover p-2 text-xs shadow-md">
      <p className="font-medium">{item.name}</p>
      <p>X: {point.x?.toPrecision(6)}</p>
      <p>Y: {point.y?.toPrecision(6)}</p>
      {Number.isFinite(point.elapsedSeconds) && (
        <p className="text-muted-foreground">Elapsed: {formatElapsedTime(point.elapsedSeconds!)}</p>
      )}
    </div>
  );
}

export default function PhaseSpaceComparison({ runs, onLoadFile }: PhaseSpaceComparisonProps) {
  const models = useMemo(() => buildComparisonModelOptions(runs), [runs]);
  const [modelKey, setModelKey] = useState(models[0]?.key ?? "");
  const [kind, setKind] = useState<EntitySeriesKind>("link");
  const [element, setElement] = useState("");
  const [mode, setMode] = useState<PhaseSpaceMode>("rating");
  const [xMetric, setXMetric] = useState("");
  const [yMetric, setYMetric] = useState("");
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
    // Loading is intentionally keyed only by the selected model.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelKey]);

  const indexedByEngine = useMemo(
    () => runs.map((run, index) => {
      const report = selectedModel?.results[index]?.reportContent;
      return {
        label: run.label,
        index: indexEntitySeries(report ? parseTimeSeries(report) : []),
      };
    }),
    [runs, selectedModel],
  );

  const availableKinds = useMemo(() => (
    (["link", "node", "subcatchment"] as EntitySeriesKind[]).filter(candidate =>
      indexedByEngine.filter(entry => entry.index[candidate].size > 0).length >= 2
    )
  ), [indexedByEngine]);

  useEffect(() => {
    if (availableKinds.length > 0 && !availableKinds.includes(kind)) {
      setKind(availableKinds[0]);
    }
  }, [availableKinds, kind]);

  const elements = useMemo(() => {
    const count = new Map<string, number>();
    for (const entry of indexedByEngine) {
      for (const name of entry.index[kind].keys()) {
        count.set(name, (count.get(name) ?? 0) + 1);
      }
    }
    return Array.from(count.entries())
      .filter(([, engines]) => engines >= 2)
      .map(([name]) => name)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [indexedByEngine, kind]);

  useEffect(() => {
    if (elements.length > 0 && !elements.includes(element)) setElement(elements[0]);
    else if (elements.length === 0 && element) setElement("");
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
  const metricNames = useMemo(() => metrics.map(metric => metric.name), [metrics]);

  useEffect(() => {
    if (metricNames.length === 0) {
      if (xMetric) setXMetric("");
      if (yMetric) setYMetric("");
      return;
    }
    const defaults = phaseMetricDefaults(metricNames, kind, mode);
    if (!metricNames.includes(xMetric)) setXMetric(defaults.xMetric);
    if (!metricNames.includes(yMetric) || (mode === "rating" && yMetric === xMetric && metricNames.length > 1)) {
      setYMetric(defaults.yMetric);
    }
  }, [metricNames, kind, mode, xMetric, yMetric]);

  const phaseEntries = useMemo(() => perEngine.map(entry => {
    const points = !entry.series
      ? []
      : mode === "rating"
        ? buildRatingPhasePoints(entry.series, xMetric, yMetric)
        : buildDerivativePhasePoints(entry.series, xMetric);
    return {
      label: entry.label,
      points,
      segments: phaseSegments(points),
      exclusionReason: phaseExclusionReason(!!entry.series, points.length, mode),
    };
  }), [perEngine, mode, xMetric, yMetric]);
  const phaseSeries = phaseEntries.filter(entry => !entry.exclusionReason);
  const excludedEngines = phaseEntries.filter(entry => entry.exclusionReason);

  const xUnit = metrics.find(metric => metric.name === xMetric)?.unit ?? "";
  const yUnit = mode === "rating"
    ? metrics.find(metric => metric.name === yMetric)?.unit ?? ""
    : xUnit ? `${xUnit}/hr` : "";
  const xLabel = `${xMetric || "State"}${xUnit ? ` (${xUnit})` : ""}`;
  const yLabel = mode === "rating"
    ? `${yMetric || "Response"}${yUnit ? ` (${yUnit})` : ""}`
    : `d${xMetric || "state"}/dt${yUnit ? ` (${yUnit})` : ""}`;
  if (models.length === 0) return null;

  return (
    <Card data-testid="card-phase-space-comparison">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Orbit className="h-5 w-5" />
          Phase Space — Engine Overlay
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Cross-plot an element&apos;s state and response to compare its hydraulic trajectory across engines.
          Circle marks the first point; triangle marks the last.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <label htmlFor="phase-space-file" className="block text-xs font-medium">Model</label>
            <Select value={modelKey} onValueChange={setModelKey}>
              <SelectTrigger id="phase-space-file" className="w-[240px]" data-testid="select-phase-space-file">
                <SelectValue placeholder="Choose a model" />
              </SelectTrigger>
              <SelectContent>
                {models.map(model => <SelectItem key={model.key} value={model.key}>{model.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label htmlFor="phase-space-kind" className="block text-xs font-medium">Element type</label>
            <Select
              value={availableKinds.includes(kind) ? kind : ""}
              onValueChange={value => {
                setKind(value as EntitySeriesKind);
                setElement("");
                setXMetric("");
                setYMetric("");
              }}
              disabled={availableKinds.length === 0}
            >
              <SelectTrigger id="phase-space-kind" className="w-[150px]" data-testid="select-phase-space-kind">
                <SelectValue placeholder="Element type" />
              </SelectTrigger>
              <SelectContent>
                {availableKinds.map(value => <SelectItem key={value} value={value}>{KIND_LABELS[value]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label htmlFor="phase-space-element" className="block text-xs font-medium">Element</label>
            <Select value={element} onValueChange={setElement} disabled={elements.length === 0}>
              <SelectTrigger id="phase-space-element" className="w-[210px]" data-testid="select-phase-space-element">
                <SelectValue placeholder={`Choose ${KIND_LABELS[kind].toLowerCase()}`} />
              </SelectTrigger>
              <SelectContent>
                {elements.map(name => <SelectItem key={name} value={name}>{name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label htmlFor="phase-space-mode" className="block text-xs font-medium">Phase view</label>
            <Select value={mode} onValueChange={value => {
              setMode(value as PhaseSpaceMode);
              setXMetric("");
              setYMetric("");
            }}>
              <SelectTrigger id="phase-space-mode" className="w-[180px]" data-testid="select-phase-space-mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="rating">X–Y rating plane</SelectItem>
                <SelectItem value="derivative">State–derivative plane</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {loading && <Loader2 className="h-5 w-5 animate-spin self-center text-muted-foreground" />}
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <label htmlFor="phase-space-x-metric" className="block text-xs font-medium">
              {mode === "rating" ? "X-axis metric" : "State metric"}
            </label>
            <Select value={xMetric} onValueChange={setXMetric} disabled={metrics.length === 0}>
              <SelectTrigger id="phase-space-x-metric" className="w-[240px]" data-testid="select-phase-space-x-metric">
                <SelectValue placeholder={mode === "rating" ? "X-axis metric" : "State metric"} />
              </SelectTrigger>
              <SelectContent>
                {metrics.map(metric => (
                  <SelectItem key={metric.name} value={metric.name}>
                    {metric.name}{metric.unit ? ` (${metric.unit})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {mode === "rating" && (
            <div className="space-y-1">
              <label htmlFor="phase-space-y-metric" className="block text-xs font-medium">Y-axis metric</label>
              <Select value={yMetric} onValueChange={setYMetric} disabled={metrics.length < 2}>
                <SelectTrigger id="phase-space-y-metric" className="w-[240px]" data-testid="select-phase-space-y-metric">
                  <SelectValue placeholder="Y-axis metric" />
                </SelectTrigger>
                <SelectContent>
                  {metrics.filter(metric => metric.name !== xMetric).map(metric => (
                    <SelectItem key={metric.name} value={metric.name}>
                      {metric.name}{metric.unit ? ` (${metric.unit})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <p className="self-center text-xs text-muted-foreground">
            {mode === "rating"
              ? "Trajectory direction reveals rising/falling hydraulic limbs."
              : "Derivative is a finite difference of report-step data, expressed per hour."}
          </p>
        </div>

        <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <strong>Interpret as screening evidence:</strong>{" "}
          {kind === "link"
            ? "reported link depth is a hydraulic proxy, not a second independently solved state."
            : kind === "node"
              ? "node inflow versus depth is a response pair, not the solver’s coupled state pair."
              : "rainfall versus runoff is a parametric response plane, not a hydraulic state-space orbit."}
          {mode === "derivative" && " Derivatives use report-step data; sub-report-step oscillations are not visible."}
        </div>

        {!loading && availableKinds.length === 0 && (
          <p className="text-xs text-muted-foreground" data-testid="text-phase-space-unavailable">
            No common element time series were found. Add <code>[REPORT]</code> entries such as
            {' '}<code>NODES ALL</code>, <code>LINKS ALL</code>, or <code>SUBCATCHMENTS ALL</code>, then rerun the comparison.
          </p>
        )}

        {!loading && element && excludedEngines.length > 0 && (
          <div className="text-xs text-amber-600 dark:text-amber-400" data-testid="text-phase-space-missing-engines">
            <p>Not every engine can be included in this phase overlay:</p>
            <ul className="list-disc pl-5">
              {excludedEngines.map(entry => (
                <li key={entry.label}>
                  <strong>{entry.label}:</strong> {entry.exclusionReason}.
                  {!perEngine.find(candidate => candidate.label === entry.label)?.series && (
                    <> Confirm <code>{KIND_REPORT_KEYS[kind]}</code> is enabled before rerunning this engine.</>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {!loading && element && withData.length >= 2 && metrics.length < (mode === "rating" ? 2 : 1) && (
          <p className="text-xs text-muted-foreground" data-testid="text-phase-space-no-metrics">
            This element does not have enough common metrics across the available engine reports to draw the selected phase plane.
          </p>
        )}

        {!loading && element && metrics.length >= (mode === "rating" ? 2 : 1) && phaseSeries.length < 2 && (
          <p className="text-xs text-muted-foreground" data-testid="text-phase-space-insufficient-engines">
            At least two engines need usable phase points to draw an overlay.
          </p>
        )}

        {phaseSeries.length >= 2 && (
          <>
            <div
              className="h-[400px]"
              data-testid="chart-phase-space-comparison"
              role="img"
              aria-label={`${KIND_LABELS[kind]} ${element} phase-space engine overlay. X axis ${xLabel}; Y axis ${yLabel}.`}
            >
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 12, right: 22, bottom: 18, left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis
                    type="number"
                    dataKey="x"
                    name={xLabel}
                    tick={{ fontSize: 10 }}
                    label={{ value: xLabel, position: "insideBottom", offset: -8, style: { fontSize: 10 } }}
                  />
                  <YAxis
                    type="number"
                    dataKey="y"
                    name={yLabel}
                    tick={{ fontSize: 10 }}
                    width={76}
                    label={{ value: yLabel, angle: -90, position: "insideLeft", style: { fontSize: 10 } }}
                  />
                  {mode === "derivative" && <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="5 4" />}
                  <Tooltip
                    cursor={{ strokeDasharray: "3 3" }}
                    content={<PhaseTooltip />}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {phaseSeries.flatMap((entry, index) => {
                    const color = ENGINE_COLORS[index % ENGINE_COLORS.length];
                    return entry.segments.map((segment, segmentIndex) => (
                      <Scatter
                        key={`${entry.label}-${segmentIndex}`}
                        name={entry.label}
                        data={segment}
                        line={{ stroke: color, strokeWidth: 1.75 }}
                        fill={color}
                        shape={false}
                        legendType={segmentIndex === 0 ? "circle" : "none"}
                      />
                    ));
                  })}
                  {phaseSeries.flatMap((entry, index) => {
                    const color = ENGINE_COLORS[index % ENGINE_COLORS.length];
                    return entry.segments.map((segment, segmentIndex) => (
                      <Scatter
                        key={`${entry.label}-${segmentIndex}-start`}
                        name={`${entry.label} start`}
                        data={segment.slice(0, 1)}
                        fill={color}
                        shape="circle"
                        legendType="none"
                      />
                    ));
                  })}
                  {phaseSeries.flatMap((entry, index) => {
                    const color = ENGINE_COLORS[index % ENGINE_COLORS.length];
                    return entry.segments.map((segment, segmentIndex) => (
                      <Scatter
                        key={`${entry.label}-${segmentIndex}-end`}
                        name={`${entry.label} end`}
                        data={segment.slice(-1)}
                        fill={color}
                        shape="triangle"
                        legendType="none"
                      />
                    ));
                  })}
                </ScatterChart>
              </ResponsiveContainer>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2" data-testid="phase-space-diagnostics">
              {phaseSeries.map((entry, index) => (
                <div key={entry.label} className="rounded-md border p-2 text-xs">
                  <p className="font-medium flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: ENGINE_COLORS[index % ENGINE_COLORS.length] }} />
                    {entry.label}
                  </p>
                  <p className="text-muted-foreground mt-1">{entry.points.length} points · X {phaseRange(entry.points, "x")}</p>
                  <p className="text-muted-foreground">Y {phaseRange(entry.points, "y")}</p>
                </div>
              ))}
            </div>
            <details className="rounded-md border p-2 text-xs">
              <summary className="cursor-pointer font-medium">Accessible trajectory summary</summary>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-left">
                  <caption className="sr-only">Phase-space trajectory summary by engine</caption>
                  <thead>
                    <tr className="border-b">
                      <th className="p-1">Engine</th>
                      <th className="p-1">Points</th>
                      <th className="p-1">Segments</th>
                      <th className="p-1">X range</th>
                      <th className="p-1">Y range</th>
                      <th className="p-1">Start (X, Y)</th>
                      <th className="p-1">End (X, Y)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {phaseEntries.map(entry => {
                      if (entry.exclusionReason) {
                        return (
                          <tr key={entry.label} className="border-b last:border-0">
                            <td className="p-1 font-medium">{entry.label}</td>
                            <td className="p-1" colSpan={6}>Excluded: {entry.exclusionReason}</td>
                          </tr>
                        );
                      }
                      const first = entry.points[0];
                      const last = entry.points[entry.points.length - 1];
                      return (
                        <tr key={entry.label} className="border-b last:border-0">
                          <td className="p-1 font-medium">{entry.label}</td>
                          <td className="p-1">{entry.points.length}</td>
                          <td className="p-1">{entry.segments.length}</td>
                          <td className="p-1">{phaseRange(entry.points, "x")}</td>
                          <td className="p-1">{phaseRange(entry.points, "y")}</td>
                          <td className="p-1">{first.x.toPrecision(5)}, {first.y.toPrecision(5)}</td>
                          <td className="p-1">{last.x.toPrecision(5)}, {last.y.toPrecision(5)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </details>
          </>
        )}
      </CardContent>
    </Card>
  );
}