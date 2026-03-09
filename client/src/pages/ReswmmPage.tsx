import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { Upload, Download, Scissors, BarChart3, ArrowRight, AlertTriangle, Info, MapIcon, Play, Loader2, ArrowLeft } from "lucide-react";
import type { CoordinateData, ConduitData, PolygonData } from "@/lib/inpParser";
import AppHeader from "@/components/AppHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { parseInpFile, type ParsedInpFile } from "@/lib/inpParser";
import {
  discretizeConduits,
  rebuildInpFile,
  computeCflAnalysis,
  type ReswmmConfig,
  type DiscretizedResult,
  type CflAnalysis,
  DEFAULT_RESWMM_CONFIG,
} from "@/lib/reswmmEngine";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  ResponsiveContainer, Legend,
} from "recharts";
import ResultsDisplay, { type ProcessResult } from "@/components/ResultsDisplay";
import { useToast } from "@/hooks/use-toast";

interface MiniMapProps {
  coordinates: CoordinateData[];
  conduits: ConduitData[];
  polygons?: PolygonData[];
  highlightNew?: Set<string>;
  label: string;
  testId: string;
}

function MiniNetworkMap({ coordinates, conduits, polygons = [], highlightNew, label, testId }: MiniMapProps) {
  const coordMap = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    for (const c of coordinates) {
      map.set(c.node, { x: c.x, y: c.y });
    }
    return map;
  }, [coordinates]);

  const polyXs = polygons.flatMap(p => p.vertices.map(v => v.x));
  const polyYs = polygons.flatMap(p => p.vertices.map(v => v.y));
  const allX = [...Array.from(coordMap.values()).map(c => c.x), ...polyXs];
  const allY = [...Array.from(coordMap.values()).map(c => c.y), ...polyYs];

  if (allX.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-muted-foreground text-xs">
        No coordinate data
      </div>
    );
  }

  const minX = Math.min(...allX);
  const maxX = Math.max(...allX);
  const minY = Math.min(...allY);
  const maxY = Math.max(...allY);

  const padding = 20;
  const svgWidth = 400;
  const svgHeight = 300;
  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;
  const scaleX = (svgWidth - 2 * padding) / rangeX;
  const scaleY = (svgHeight - 2 * padding) / rangeY;
  const scale = Math.min(scaleX, scaleY);

  const toSvg = (x: number, y: number) => ({
    sx: padding + (x - minX) * scale,
    sy: svgHeight - padding - (y - minY) * scale,
  });

  return (
    <div data-testid={testId}>
      <svg
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        className="w-full h-auto"
        style={{ maxHeight: 300 }}
      >
        <rect width={svgWidth} height={svgHeight} fill="none" />
        {polygons.map((poly, i) => {
          const points = poly.vertices
            .map(v => { const { sx, sy } = toSvg(v.x, v.y); return `${sx},${sy}`; })
            .join(' ');
          return (
            <polygon
              key={`poly-${i}`}
              points={points}
              fill="hsl(200, 60%, 55%)"
              fillOpacity={0.12}
              stroke="hsl(200, 60%, 55%)"
              strokeWidth={0.6}
              strokeOpacity={0.4}
            >
              <title>{poly.subcatchment}</title>
            </polygon>
          );
        })}
        {conduits.map((c, i) => {
          const fromCoord = coordMap.get(c.from);
          const toCoord = coordMap.get(c.to);
          if (!fromCoord || !toCoord) return null;
          const f = toSvg(fromCoord.x, fromCoord.y);
          const t = toSvg(toCoord.x, toCoord.y);
          const isNew = highlightNew?.has(c.name);
          return (
            <line
              key={`link-${i}`}
              x1={f.sx} y1={f.sy} x2={t.sx} y2={t.sy}
              stroke={isNew ? 'hsl(142, 60%, 50%)' : 'hsl(var(--muted-foreground))'}
              strokeWidth={isNew ? 1.5 : 1}
              strokeOpacity={isNew ? 0.8 : 0.5}
            />
          );
        })}
        {Array.from(coordMap.entries()).map(([name, coord]) => {
          const { sx, sy } = toSvg(coord.x, coord.y);
          const isNew = highlightNew?.has(name);
          return (
            <circle
              key={`node-${name}`}
              cx={sx} cy={sy}
              r={isNew ? 2.5 : 2}
              fill={isNew ? 'hsl(142, 60%, 50%)' : 'hsl(210, 70%, 50%)'}
              stroke="none"
            >
              <title>{name}</title>
            </circle>
          );
        })}
        <text x={padding} y={14} fontSize={11} fill="hsl(var(--muted-foreground))" fontWeight="500">
          {label}
        </text>
      </svg>
    </div>
  );
}

function computeLengthStats(lengths: number[]) {
  if (lengths.length === 0) return { min: 0, max: 0, mean: 0, stdDev: 0 };
  const min = Math.min(...lengths);
  const max = Math.max(...lengths);
  const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  const variance = lengths.reduce((acc, l) => acc + (l - mean) ** 2, 0) / lengths.length;
  return { min, max, mean, stdDev: Math.sqrt(variance) };
}

function buildHistogram(values: number[], binCount = 15) {
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) return [{ range: `${min.toFixed(0)}`, count: values.length }];
  const binSize = (max - min) / binCount;
  const bins = Array.from({ length: binCount }, (_, i) => ({
    range: `${(min + i * binSize).toFixed(0)}-${(min + (i + 1) * binSize).toFixed(0)}`,
    count: 0,
  }));
  for (const v of values) {
    const idx = Math.min(Math.floor((v - min) / binSize), binCount - 1);
    bins[idx].count++;
  }
  return bins.filter(b => b.count > 0);
}


interface SimComparisonProps {
  beforeResult: ProcessResult;
  afterResult: ProcessResult;
  beforeElapsed: string;
  afterElapsed: string;
  beforeLabel: string;
  afterLabel: string;
}

function getContinuityColor(error: number | undefined): string {
  if (error === undefined) return 'text-muted-foreground';
  const abs = Math.abs(error);
  if (abs <= 1) return 'text-green-600';
  if (abs <= 5) return 'text-yellow-600';
  return 'text-red-600';
}

function SimulationComparison({ beforeResult, afterResult, beforeElapsed, afterElapsed, beforeLabel, afterLabel }: SimComparisonProps) {
  const bm = beforeResult.parsedMetrics;
  const am = afterResult.parsedMetrics;

  const comparisonRows = [
    { label: 'Status', before: beforeResult.status, after: afterResult.status, type: 'status' as const },
    { label: 'Processing Time', before: beforeElapsed, after: afterElapsed, type: 'text' as const },
    { label: 'Runoff Continuity Error (%)', before: bm?.runoffContinuityError, after: am?.runoffContinuityError, type: 'continuity' as const },
    { label: 'Routing Continuity Error (%)', before: bm?.routingContinuityError, after: am?.routingContinuityError, type: 'continuity' as const },
    { label: 'Nodes Flooded', before: bm?.nodesFlooded, after: am?.nodesFlooded, type: 'number' as const },
    { label: 'Flooding Loss', before: bm?.floodingLoss, after: am?.floodingLoss, type: 'decimal' as const },
    { label: 'Total Precipitation', before: bm?.totalPrecipitation, after: am?.totalPrecipitation, type: 'decimal' as const },
    { label: 'Surface Runoff', before: bm?.surfaceRunoff, after: am?.surfaceRunoff, type: 'decimal' as const },
    { label: 'Total Inflow', before: bm?.totalInflow, after: am?.totalInflow, type: 'decimal' as const },
    { label: 'Total Outflow', before: bm?.totalOutflow, after: am?.totalOutflow, type: 'decimal' as const },
    { label: 'Flow Routing Method', before: bm?.flowRoutingMethod, after: am?.flowRoutingMethod, type: 'text' as const },
    { label: 'Infiltration Method', before: bm?.infiltrationMethod, after: am?.infiltrationMethod, type: 'text' as const },
  ];

  const chartData = [
    bm?.runoffContinuityError !== undefined && am?.runoffContinuityError !== undefined
      ? { metric: 'Runoff CE (%)', before: Math.abs(bm.runoffContinuityError), after: Math.abs(am.runoffContinuityError) }
      : null,
    bm?.routingContinuityError !== undefined && am?.routingContinuityError !== undefined
      ? { metric: 'Routing CE (%)', before: Math.abs(bm.routingContinuityError), after: Math.abs(am.routingContinuityError) }
      : null,
    bm?.nodesFlooded !== undefined && am?.nodesFlooded !== undefined
      ? { metric: 'Nodes Flooded', before: bm.nodesFlooded, after: am.nodesFlooded }
      : null,
  ].filter(Boolean);

  const volumeData = [
    bm?.totalPrecipitation !== undefined && am?.totalPrecipitation !== undefined
      ? { metric: 'Precipitation', before: bm.totalPrecipitation, after: am.totalPrecipitation }
      : null,
    bm?.surfaceRunoff !== undefined && am?.surfaceRunoff !== undefined
      ? { metric: 'Surface Runoff', before: bm.surfaceRunoff, after: am.surfaceRunoff }
      : null,
    bm?.totalInflow !== undefined && am?.totalInflow !== undefined
      ? { metric: 'Total Inflow', before: bm.totalInflow, after: am.totalInflow }
      : null,
    bm?.totalOutflow !== undefined && am?.totalOutflow !== undefined
      ? { metric: 'Total Outflow', before: bm.totalOutflow, after: am.totalOutflow }
      : null,
    bm?.floodingLoss !== undefined && am?.floodingLoss !== undefined
      ? { metric: 'Flooding Loss', before: bm.floodingLoss, after: am.floodingLoss }
      : null,
  ].filter(Boolean);

  const formatVal = (val: any, type: string) => {
    if (val === undefined || val === null) return 'N/A';
    if (type === 'status') return val === 'success' ? 'Success' : 'Failed';
    if (type === 'continuity') return typeof val === 'number' ? val.toFixed(3) : String(val);
    if (type === 'decimal') return typeof val === 'number' ? val.toFixed(3) : String(val);
    if (type === 'number') return String(val);
    return String(val);
  };

  const computeDelta = (before: any, after: any, type: string) => {
    if (type === 'text' || type === 'status') return '';
    if (typeof before !== 'number' || typeof after !== 'number') return '';
    const diff = after - before;
    const sign = diff >= 0 ? '+' : '';
    if (type === 'continuity' || type === 'decimal') return `${sign}${diff.toFixed(3)}`;
    return `${sign}${diff}`;
  };

  return (
    <div className="space-y-6 mt-6">
      <Separator />
      <h3 className="text-lg font-semibold" data-testid="text-sim-comparison-heading">
        Simulation Results Comparison
      </h3>
      <p className="text-sm text-muted-foreground">
        Side-by-side comparison of SWMM simulation results for the original and discretized models.
      </p>

      <Card data-testid="card-sim-comparison-table">
        <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Results Summary</CardTitle>
          <BarChart3 className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="table-sim-comparison">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 pr-4 text-muted-foreground font-medium">Metric</th>
                  <th className="text-right py-2 px-4 text-muted-foreground font-medium">Original</th>
                  <th className="text-right py-2 px-4 text-muted-foreground font-medium">Discretized</th>
                  <th className="text-right py-2 pl-4 text-muted-foreground font-medium">Change</th>
                </tr>
              </thead>
              <tbody>
                {comparisonRows.map((row) => (
                  <tr key={row.label} className="border-b border-border/50">
                    <td className="py-2 pr-4 text-muted-foreground">{row.label}</td>
                    <td className={`text-right py-2 px-4 ${row.type === 'continuity' ? getContinuityColor(row.before as number | undefined) : ''} ${row.type === 'status' ? (row.before === 'success' ? 'text-green-600' : 'text-red-600') : ''}`}>
                      {formatVal(row.before, row.type)}
                    </td>
                    <td className={`text-right py-2 px-4 ${row.type === 'continuity' ? getContinuityColor(row.after as number | undefined) : ''} ${row.type === 'status' ? (row.after === 'success' ? 'text-green-600' : 'text-red-600') : ''}`}>
                      {formatVal(row.after, row.type)}
                    </td>
                    <td className="text-right py-2 pl-4 text-muted-foreground text-xs">
                      {computeDelta(row.before, row.after, row.type)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {chartData.length > 0 && (
          <Card data-testid="card-sim-errors-chart">
            <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Continuity Errors and Flooding</CardTitle>
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={chartData} barGap={0} barCategoryGap="25%">
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="metric" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <RechartsTooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="before" name="Original" fill="hsl(210, 85%, 50%)" fillOpacity={0.8} />
                  <Bar dataKey="after" name="Discretized" fill="hsl(142, 60%, 40%)" fillOpacity={0.8} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {volumeData.length > 0 && (
          <Card data-testid="card-sim-volumes-chart">
            <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Volume Comparison</CardTitle>
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={volumeData} barGap={0} barCategoryGap="25%">
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="metric" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <RechartsTooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="before" name="Original" fill="hsl(35, 90%, 50%)" fillOpacity={0.8} />
                  <Bar dataKey="after" name="Discretized" fill="hsl(270, 60%, 55%)" fillOpacity={0.8} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

type SimRunState = 'idle' | 'uploading' | 'processing' | 'completed';

function formatRunTime(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs.toFixed(0)}s`;
}

export default function ReswmmPage() {
  const [fileName, setFileName] = useState<string>('');
  const [originalContent, setOriginalContent] = useState<string>('');
  const [parsed, setParsed] = useState<ParsedInpFile | null>(null);
  const [config, setConfig] = useState<ReswmmConfig>(DEFAULT_RESWMM_CONFIG);
  const [result, setResult] = useState<DiscretizedResult | null>(null);
  const [cflBefore, setCflBefore] = useState<CflAnalysis[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [beforeRunState, setBeforeRunState] = useState<SimRunState>('idle');
  const [beforeRunResults, setBeforeRunResults] = useState<ProcessResult[]>([]);
  const [beforeRunElapsed, setBeforeRunElapsed] = useState('');
  const [beforeRunProgress, setBeforeRunProgress] = useState('');
  const wsBeforeRef = useRef<WebSocket | null>(null);
  const beforeStartRef = useRef<number | null>(null);

  const [afterRunState, setAfterRunState] = useState<SimRunState>('idle');
  const [afterRunResults, setAfterRunResults] = useState<ProcessResult[]>([]);
  const [afterRunElapsed, setAfterRunElapsed] = useState('');
  const [afterRunProgress, setAfterRunProgress] = useState('');
  const wsAfterRef = useRef<WebSocket | null>(null);
  const afterStartRef = useRef<number | null>(null);

  const [showingResults, setShowingResults] = useState<'before' | 'after' | null>(null);

  const { toast } = useToast();

  useEffect(() => {
    return () => {
      if (wsBeforeRef.current) { wsBeforeRef.current.close(); wsBeforeRef.current = null; }
      if (wsAfterRef.current) { wsAfterRef.current.close(); wsAfterRef.current = null; }
    };
  }, []);

  const runInpContent = async (
    content: string,
    runFileName: string,
    which: 'before' | 'after',
  ) => {
    const setRunState = which === 'before' ? setBeforeRunState : setAfterRunState;
    const setRunResults = which === 'before' ? setBeforeRunResults : setAfterRunResults;
    const setRunElapsed = which === 'before' ? setBeforeRunElapsed : setAfterRunElapsed;
    const setRunProgress = which === 'before' ? setBeforeRunProgress : setAfterRunProgress;
    const wsRef = which === 'before' ? wsBeforeRef : wsAfterRef;
    const startRef = which === 'before' ? beforeStartRef : afterStartRef;

    try {
      setRunState('uploading');
      setRunResults([]);
      setRunElapsed('');
      setRunProgress('Uploading...');
      startRef.current = Date.now();

      const blob = new Blob([content], { type: 'text/plain' });
      const formData = new FormData();
      formData.append('files', blob, runFileName);

      const uploadResponse = await fetch('/api/upload', { method: 'POST', body: formData });
      if (!uploadResponse.ok) throw new Error('Failed to upload file');

      const batchJob = await uploadResponse.json();
      setRunState('processing');
      setRunProgress('Running SWMM...');

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/api/ws?jobId=${batchJob.id}`);

      let collectedResult: ProcessResult | null = null;

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'progress') {
          setRunProgress(`Processing ${data.fileName}...`);
        } else if (data.type === 'file_progress') {
          setRunProgress(`${data.percentage}%`);
        } else if (data.type === 'result') {
          collectedResult = data.result;
          setRunResults([data.result]);
        } else if (data.type === 'completed') {
          const finalResult = collectedResult || {
            id: 'unknown',
            fileName: runFileName,
            filePath: '',
            status: 'failed' as const,
            error: 'No result received from server',
          };
          setRunResults([finalResult]);
          setRunState('completed');
          if (startRef.current) {
            setRunElapsed(formatRunTime((Date.now() - startRef.current) / 1000));
          }
          ws.close();
          wsRef.current = null;
          setShowingResults(which);
          toast({ title: "Simulation Complete", description: `${runFileName} has been processed.` });
        }
      };

      ws.onerror = () => {
        setRunState('idle');
        setRunProgress('');
        wsRef.current = null;
        toast({ title: "Error", description: "WebSocket connection failed.", variant: "destructive" });
      };

      wsRef.current = ws;

      const startResponse = await fetch(`/api/batch/${batchJob.id}/start`, { method: 'POST' });
      if (!startResponse.ok) throw new Error('Failed to start simulation');
    } catch (error) {
      console.error('Run error:', error);
      setRunState('idle');
      setRunProgress('');
      if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
      toast({ title: "Error", description: "Failed to run simulation.", variant: "destructive" });
    }
  };

  const handleRunBefore = () => {
    if (!originalContent || !fileName) return;
    runInpContent(originalContent, fileName, 'before');
  };

  const handleRunAfter = () => {
    if (!parsed || !result || !originalContent) return;
    const rebuilt = rebuildInpFile(originalContent, parsed, result, config);
    const baseName = fileName.replace(/\.inp$/i, '');
    runInpContent(rebuilt, `ReSWMM_${baseName}.inp`, 'after');
  };

  const handleBackFromRunResults = () => {
    setShowingResults(null);
  };

  const resetRunStates = () => {
    setBeforeRunState('idle');
    setBeforeRunResults([]);
    setBeforeRunElapsed('');
    setBeforeRunProgress('');
    setAfterRunState('idle');
    setAfterRunResults([]);
    setAfterRunElapsed('');
    setAfterRunProgress('');
    setShowingResults(null);
    if (wsBeforeRef.current) { wsBeforeRef.current.close(); wsBeforeRef.current = null; }
    if (wsAfterRef.current) { wsAfterRef.current.close(); wsAfterRef.current = null; }
  };

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setResult(null);
    resetRunStates();
    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = ev.target?.result as string;
      setOriginalContent(content);
      const p = parseInpFile(content);
      setParsed(p);
      setCflBefore(computeCflAnalysis(p));
    };
    reader.readAsText(file);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file || !file.name.toLowerCase().endsWith('.inp')) return;
    setFileName(file.name);
    setResult(null);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = ev.target?.result as string;
      setOriginalContent(content);
      const p = parseInpFile(content);
      setParsed(p);
      setCflBefore(computeCflAnalysis(p));
    };
    reader.readAsText(file);
  }, []);

  const handleDiscretize = useCallback(() => {
    if (!parsed) return;
    resetRunStates();
    const r = discretizeConduits(parsed, config);
    setResult(r);
  }, [parsed, config]);

  const handleDownload = useCallback(() => {
    if (!parsed || !result) return;
    const rebuilt = rebuildInpFile(originalContent, parsed, result, config);
    const baseName = fileName.replace(/\.inp$/i, '');
    const blob = new Blob([rebuilt], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ReSWMM_${baseName}.inp`;
    a.click();
    URL.revokeObjectURL(url);
  }, [parsed, result, originalContent, config, fileName]);

  const beforeLengths = useMemo(() => parsed?.conduits.map(c => c.length) || [], [parsed]);
  const afterLengths = useMemo(() => result?.newConduits.map(c => c.length) || [], [result]);
  const beforeStats = useMemo(() => computeLengthStats(beforeLengths), [beforeLengths]);
  const afterStats = useMemo(() => computeLengthStats(afterLengths), [afterLengths]);
  const beforeTotalLength = useMemo(() => beforeLengths.reduce((a, b) => a + b, 0), [beforeLengths]);
  const afterTotalLength = useMemo(() => afterLengths.reduce((a, b) => a + b, 0), [afterLengths]);
  const beforeHist = useMemo(() => buildHistogram(beforeLengths), [beforeLengths]);
  const afterHist = useMemo(() => buildHistogram(afterLengths), [afterLengths]);

  const lengthRatioWarning = useMemo(() => {
    if (beforeStats.min === 0) return false;
    return beforeStats.max / beforeStats.min > 4;
  }, [beforeStats]);

  const cflBeforeHist = useMemo(() => {
    const vals = cflBefore.map(c => c.standardTimeStep).filter(v => isFinite(v));
    return buildHistogram(vals, 12);
  }, [cflBefore]);

  const cflAfterAnalysis = useMemo(() => {
    if (!result || !parsed) return [];
    const xsMap = new Map(result.newXSections.map(xs => [xs.link, xs]));
    const isUS = parsed.options.flowUnits === 'CFS' || parsed.options.flowUnits === 'GPM' || parsed.options.flowUnits === 'MGD';
    const g = isUS ? 32.174 : 9.81;
    return result.newConduits.map(c => {
      const xs = xsMap.get(c.name);
      const diameter = xs ? (parseFloat(xs.geom1) || 1) : 1;
      const celerity = Math.sqrt(g * diameter);
      const standardTs = celerity > 0 ? c.length / celerity : 999;
      return { conduitName: c.name, length: c.length, diameter, standardTimeStep: standardTs, conservativeTimeStep: standardTs * 0.10 };
    });
  }, [result, parsed]);

  const cflAfterHist = useMemo(() => {
    const vals = cflAfterAnalysis.map(c => c.standardTimeStep).filter(v => isFinite(v));
    return buildHistogram(vals, 12);
  }, [cflAfterAnalysis]);

  const afterCoordinates = useMemo(() => {
    if (!parsed || !result) return [];
    return [...parsed.coordinates, ...result.newCoordinates];
  }, [parsed, result]);

  const afterConduits = useMemo(() => {
    if (!result) return [];
    return result.newConduits;
  }, [result]);

  const newElementNames = useMemo(() => {
    if (!result) return new Set<string>();
    const names = new Set<string>();
    for (const j of result.newJunctions) names.add(j.name);
    for (const c of result.newCoordinates) names.add(c.node);
    const originalNames = new Set(parsed?.conduits.map(c => c.name) || []);
    for (const c of result.newConduits) {
      if (!originalNames.has(c.name)) names.add(c.name);
    }
    return names;
  }, [result, parsed]);

  const flowUnit = useMemo(() => {
    if (!parsed) return 'ft';
    const isUS = parsed.options.flowUnits === 'CFS' || parsed.options.flowUnits === 'GPM' || parsed.options.flowUnits === 'MGD';
    return isUS ? 'ft' : 'm';
  }, [parsed]);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <AppHeader />
      <main className="container max-w-6xl mx-auto px-8 py-8 flex-1">
        <div className="space-y-6">
          <div>
            <h2 className="text-xl font-semibold" data-testid="text-reswmm-title">ReSWMM Conduit Discretization</h2>
            <p className="text-sm text-muted-foreground mt-1" data-testid="text-reswmm-subtitle">
              Split long conduits into shorter segments for improved numerical stability in SWMM dynamic wave routing.
            </p>
            <p className="text-sm text-muted-foreground mt-2" data-testid="text-reswmm-description">
              Long conduits in SWMM models can cause Courant-Friedrichs-Lewy (CFL) violations during dynamic wave routing,
              leading to numerical instability, mass balance errors, and simulation crashes. ReSWMM automatically subdivides
              conduits that exceed a target length by inserting intermediate junction nodes with interpolated elevations and
              coordinates. Two discretization methods are available: Fixed Interval splits conduits based on a user-defined
              minimum and maximum segment length, while the Δx/D Ratio method sizes segments relative to the conduit
              diameter for hydraulically consistent discretization. The tool preserves all original network connectivity,
              distributes entry/exit losses across new segments, and generates a modified .inp file ready for simulation.
            </p>
          </div>

          {!parsed && (
            <Card
              className="border-dashed"
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              data-testid="card-reswmm-upload"
            >
              <CardContent className="p-8">
                <div className="flex flex-col items-center gap-4 text-center">
                  <Upload className="h-10 w-10 text-muted-foreground" />
                  <div>
                    <p className="font-medium">Upload an .inp file</p>
                    <p className="text-sm text-muted-foreground mt-1">Drag and drop or click to browse</p>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".inp"
                    onChange={handleFileUpload}
                    className="hidden"
                    data-testid="input-reswmm-file"
                  />
                  <Button onClick={() => fileInputRef.current?.click()} data-testid="button-reswmm-browse">
                    Browse Files
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {parsed && (
            <>
              <div className="flex items-center gap-3 flex-wrap">
                <Badge variant="outline" data-testid="badge-reswmm-filename">{fileName}</Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { setParsed(null); setResult(null); setFileName(''); setOriginalContent(''); setCflBefore([]); if (fileInputRef.current) fileInputRef.current.value = ''; }}
                  data-testid="button-reswmm-clear"
                >
                  Change File
                </Button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <Card data-testid="card-stat-conduits">
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground">Conduits</p>
                    <p className="text-2xl font-semibold" data-testid="text-stat-conduits">{parsed.counts.conduits}</p>
                  </CardContent>
                </Card>
                <Card data-testid="card-stat-junctions">
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground">Junctions</p>
                    <p className="text-2xl font-semibold" data-testid="text-stat-junctions">{parsed.counts.junctions}</p>
                  </CardContent>
                </Card>
                <Card data-testid="card-stat-length-range">
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground">Length Range ({flowUnit})</p>
                    <p className="text-2xl font-semibold" data-testid="text-stat-length-range">
                      {beforeStats.min.toFixed(0)} - {beforeStats.max.toFixed(0)}
                    </p>
                  </CardContent>
                </Card>
                <Card data-testid="card-stat-flow-units">
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground">Flow Units / Routing</p>
                    <p className="text-2xl font-semibold" data-testid="text-stat-flow-units">
                      {parsed.options.flowUnits || 'N/A'}
                    </p>
                    <p className="text-xs text-muted-foreground">{parsed.options.routingMethod || ''}</p>
                  </CardContent>
                </Card>
              </div>

              {lengthRatioWarning && (
                <Card className="border-yellow-500/30 bg-yellow-500/5" data-testid="card-length-warning">
                  <CardContent className="p-4 flex gap-3">
                    <AlertTriangle className="h-5 w-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                    <div className="text-sm">
                      <p className="font-medium" data-testid="text-length-warning">Length Ratio Warning</p>
                      <p className="text-muted-foreground">
                        Max/Min ratio is {(beforeStats.max / beforeStats.min).toFixed(1)}x (threshold: 4x). Discretization is recommended.
                      </p>
                    </div>
                  </CardContent>
                </Card>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card data-testid="card-length-distribution-before">
                  <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Conduit Length Distribution</CardTitle>
                    <BarChart3 className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={beforeHist}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="range" tick={{ fontSize: 10 }} />
                        <YAxis />
                        <RechartsTooltip />
                        <Bar dataKey="count" fill="hsl(210, 85%, 50%)" />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                <Card data-testid="card-cfl-distribution-before">
                  <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">CFL Time Step Distribution (s)</CardTitle>
                    <Info className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={cflBeforeHist}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="range" tick={{ fontSize: 10 }} />
                        <YAxis />
                        <RechartsTooltip />
                        <Bar dataKey="count" fill="hsl(142, 60%, 40%)" />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </div>

              <Separator />

              <Card data-testid="card-config">
                <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Discretization Configuration</CardTitle>
                  <Scissors className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent className="space-y-6">
                  <div>
                    <Label className="text-xs text-muted-foreground mb-2 block">Method</Label>
                    <ToggleGroup
                      type="single"
                      value={config.method}
                      onValueChange={(v) => v && setConfig(prev => ({ ...prev, method: v as ReswmmConfig['method'] }))}
                      data-testid="reswmm-method"
                    >
                      <ToggleGroupItem value="fixed_interval" data-testid="toggle-fixed-interval">
                        Fixed Interval
                      </ToggleGroupItem>
                      <ToggleGroupItem value="dx_d_ratio" data-testid="toggle-dx-d-ratio">
                        &Delta;x/D Ratio
                      </ToggleGroupItem>
                    </ToggleGroup>
                  </div>

                  {config.method === 'fixed_interval' && (
                    <div className="space-y-4">
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <Label className="text-xs">Min Length</Label>
                          <span className="text-xs text-muted-foreground" data-testid="text-reswmm-min-len">
                            {config.fixedMinLength} {flowUnit}
                          </span>
                        </div>
                        <Slider
                          min={10}
                          max={500}
                          step={5}
                          value={[config.fixedMinLength]}
                          onValueChange={([v]) => setConfig(prev => ({ ...prev, fixedMinLength: v }))}
                          data-testid="slider-reswmm-min-len"
                        />
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <Label className="text-xs">Max Length</Label>
                          <span className="text-xs text-muted-foreground" data-testid="text-reswmm-max-len">
                            {config.fixedMaxLength} {flowUnit}
                          </span>
                        </div>
                        <Slider
                          min={50}
                          max={1000}
                          step={10}
                          value={[config.fixedMaxLength]}
                          onValueChange={([v]) => setConfig(prev => ({ ...prev, fixedMaxLength: v }))}
                          data-testid="slider-reswmm-max-len"
                        />
                      </div>
                    </div>
                  )}

                  {config.method === 'dx_d_ratio' && (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <Label className="text-xs">&Delta;x/D Ratio</Label>
                        <span className="text-xs text-muted-foreground" data-testid="text-reswmm-dxd">
                          {config.dxDRatio}
                        </span>
                      </div>
                      <Slider
                        min={1}
                        max={20}
                        step={0.5}
                        value={[config.dxDRatio]}
                        onValueChange={([v]) => setConfig(prev => ({ ...prev, dxDRatio: v }))}
                        data-testid="slider-reswmm-dxd"
                      />
                    </div>
                  )}

                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <Label className="text-xs">MNSA (Min Nodal Surface Area)</Label>
                      <span className="text-xs text-muted-foreground" data-testid="text-reswmm-mnsa">
                        {config.mnsa} {flowUnit === 'ft' ? 'ft' : 'm'}&sup2;
                      </span>
                    </div>
                    <Slider
                      min={0.1}
                      max={100}
                      step={0.1}
                      value={[config.mnsa]}
                      onValueChange={([v]) => setConfig(prev => ({ ...prev, mnsa: +v.toFixed(1) }))}
                      data-testid="slider-reswmm-mnsa"
                    />
                  </div>

                  <Separator />

                  <div className="space-y-4">
                    <div>
                      <Label className="text-xs text-muted-foreground mb-2 block">Automatic Conduit Lengthening (Short Pipes)</Label>
                      <p className="text-xs text-muted-foreground mb-3">
                        Short conduits can violate the Courant condition during dynamic wave routing.
                        When enabled, ReSWMM lengthens any conduit shorter than celerity x time step before discretization.
                        The LENGTHENING_STEP value is also written to the [OPTIONS] section of the output .inp file.
                      </p>
                      <ToggleGroup
                        type="single"
                        value={config.lengtheningEnabled ? 'on' : 'off'}
                        onValueChange={(v) => v && setConfig(prev => ({ ...prev, lengtheningEnabled: v === 'on' }))}
                        data-testid="reswmm-lengthening-toggle"
                      >
                        <ToggleGroupItem value="off" data-testid="toggle-lengthening-off">
                          Off
                        </ToggleGroupItem>
                        <ToggleGroupItem value="on" data-testid="toggle-lengthening-on">
                          On
                        </ToggleGroupItem>
                      </ToggleGroup>
                    </div>

                    {config.lengtheningEnabled && (
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <Label className="text-xs">LENGTHENING_STEP (seconds)</Label>
                          <span className="text-xs text-muted-foreground" data-testid="text-reswmm-lengthening-step">
                            {config.lengtheningStep} s
                          </span>
                        </div>
                        <Slider
                          min={0}
                          max={60}
                          step={0.5}
                          value={[config.lengtheningStep]}
                          onValueChange={([v]) => setConfig(prev => ({ ...prev, lengtheningStep: +v.toFixed(1) }))}
                          data-testid="slider-reswmm-lengthening"
                        />
                        <p className="text-xs text-muted-foreground mt-2">
                          A value of 0 disables lengthening. Typical values are 1-10 seconds. SWMM will lengthen conduits
                          whose travel time is less than this value.
                        </p>
                      </div>
                    )}
                  </div>

                  <Button onClick={handleDiscretize} data-testid="button-discretize">
                    <Scissors className="h-4 w-4 mr-2" />
                    Discretize
                  </Button>
                </CardContent>
              </Card>

              {showingResults && (
                <>
                  <Separator />
                  <div className="space-y-4">
                    <div className="flex items-center gap-3 flex-wrap">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleBackFromRunResults}
                        data-testid="button-back-from-run-results"
                      >
                        <ArrowLeft className="h-3.5 w-3.5 mr-1" />
                        Back to ReSWMM
                      </Button>
                      <span className="text-sm text-muted-foreground">
                        {showingResults === 'before' ? 'Original Model' : 'Discretized Model'} Results
                      </span>
                    </div>
                    <ResultsDisplay
                      results={showingResults === 'before' ? beforeRunResults : afterRunResults}
                      elapsedTime={showingResults === 'before' ? beforeRunElapsed : afterRunElapsed}
                    />
                  </div>
                </>
              )}

              {!showingResults && result && (
                <>
                  <Separator />

                  <div>
                    <h3 className="text-lg font-semibold mb-4" data-testid="text-results-heading">Discretization Results</h3>

                    <Card className="mb-4" data-testid="card-summary">
                      <CardContent className="p-4 space-y-1">
                        {result.stats.lengtheningCount > 0 && (
                          <p className="text-sm" data-testid="text-summary-lengthening">
                            {result.stats.lengtheningCount} short conduit{result.stats.lengtheningCount !== 1 ? 's' : ''} lengthened (added {result.stats.lengtheningTotalAdded.toFixed(1)} {flowUnit} total).
                          </p>
                        )}
                        <p className="text-sm" data-testid="text-summary">
                          {result.stats.splitCount} conduit{result.stats.splitCount !== 1 ? 's' : ''} split into {result.stats.newConduitCount} segments, {result.stats.newJunctionCount} new junction{result.stats.newJunctionCount !== 1 ? 's' : ''} added.
                        </p>
                      </CardContent>
                    </Card>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                      <Card data-testid="card-map-before">
                        <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
                          <CardTitle className="text-sm font-medium">Before - Network Map</CardTitle>
                          <MapIcon className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                          <MiniNetworkMap
                            coordinates={parsed.coordinates}
                            conduits={parsed.conduits}
                            polygons={parsed.polygons}
                            label={`${result.stats.originalConduitCount} conduits, ${parsed.counts.junctions} junctions`}
                            testId="svg-map-before"
                          />
                          <div className="grid grid-cols-3 gap-2 mt-3 text-center">
                            <div>
                              <p className="text-xs text-muted-foreground">Conduits</p>
                              <p className="text-sm font-semibold" data-testid="text-map-before-conduits">{result.stats.originalConduitCount}</p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">Junctions</p>
                              <p className="text-sm font-semibold" data-testid="text-map-before-junctions">{parsed.counts.junctions}</p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">Avg Length</p>
                              <p className="text-sm font-semibold" data-testid="text-map-before-avg">{beforeStats.mean.toFixed(0)} {flowUnit}</p>
                            </div>
                          </div>
                        </CardContent>
                      </Card>

                      <Card data-testid="card-map-after">
                        <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
                          <CardTitle className="text-sm font-medium">After - Network Map</CardTitle>
                          <MapIcon className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                          <MiniNetworkMap
                            coordinates={afterCoordinates}
                            conduits={afterConduits}
                            polygons={parsed.polygons}
                            highlightNew={newElementNames}
                            label={`${result.stats.newConduitCount} conduits, ${parsed.counts.junctions + result.stats.newJunctionCount} junctions`}
                            testId="svg-map-after"
                          />
                          <div className="grid grid-cols-3 gap-2 mt-3 text-center">
                            <div>
                              <p className="text-xs text-muted-foreground">Conduits</p>
                              <p className="text-sm font-semibold" data-testid="text-map-after-conduits">{result.stats.newConduitCount}</p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">Junctions</p>
                              <p className="text-sm font-semibold" data-testid="text-map-after-junctions">{parsed.counts.junctions + result.stats.newJunctionCount}</p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">Avg Length</p>
                              <p className="text-sm font-semibold" data-testid="text-map-after-avg">{afterStats.mean.toFixed(0)} {flowUnit}</p>
                            </div>
                          </div>
                          {newElementNames.size > 0 && (
                            <div className="flex items-center gap-3 mt-3 text-xs text-muted-foreground justify-center flex-wrap">
                              <span className="flex items-center gap-1">
                                <span className="inline-block w-2.5 h-0.5" style={{ backgroundColor: 'hsl(var(--muted-foreground))', opacity: 0.5 }} />
                                Original
                              </span>
                              <span className="flex items-center gap-1">
                                <span className="inline-block w-2.5 h-0.5" style={{ backgroundColor: 'hsl(142, 60%, 50%)' }} />
                                New segments
                              </span>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    </div>

                    <Card className="mb-6" data-testid="card-comparison-table">
                      <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Before / After Comparison</CardTitle>
                        <BarChart3 className="h-4 w-4 text-muted-foreground" />
                      </CardHeader>
                      <CardContent>
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm" data-testid="table-comparison">
                            <thead>
                              <tr className="border-b">
                                <th className="text-left py-2 pr-4 text-muted-foreground font-medium">Metric</th>
                                <th className="text-right py-2 px-4 text-muted-foreground font-medium">Before</th>
                                <th className="text-right py-2 px-4 text-muted-foreground font-medium">After</th>
                                <th className="text-right py-2 pl-4 text-muted-foreground font-medium">Change</th>
                              </tr>
                            </thead>
                            <tbody>
                              <tr className="border-b border-border/50">
                                <td className="py-2 pr-4 text-muted-foreground">Conduits</td>
                                <td className="text-right py-2 px-4" data-testid="text-before-conduits">{result.stats.originalConduitCount}</td>
                                <td className="text-right py-2 px-4" data-testid="text-after-conduits">{result.stats.newConduitCount}</td>
                                <td className="text-right py-2 pl-4 text-muted-foreground">+{result.stats.newConduitCount - result.stats.originalConduitCount}</td>
                              </tr>
                              <tr className="border-b border-border/50">
                                <td className="py-2 pr-4 text-muted-foreground">Junctions</td>
                                <td className="text-right py-2 px-4" data-testid="text-before-junctions">{parsed.counts.junctions}</td>
                                <td className="text-right py-2 px-4" data-testid="text-after-junctions">{parsed.counts.junctions + result.stats.newJunctionCount}</td>
                                <td className="text-right py-2 pl-4 text-muted-foreground">+{result.stats.newJunctionCount}</td>
                              </tr>
                              {result.stats.lengtheningCount > 0 && (
                                <tr className="border-b border-border/50">
                                  <td className="py-2 pr-4 text-muted-foreground">Conduits Lengthened</td>
                                  <td className="text-right py-2 px-4" data-testid="text-before-lengthened">-</td>
                                  <td className="text-right py-2 px-4" data-testid="text-after-lengthened">{result.stats.lengtheningCount}</td>
                                  <td className="text-right py-2 pl-4 text-muted-foreground">+{result.stats.lengtheningTotalAdded.toFixed(1)} {flowUnit}</td>
                                </tr>
                              )}
                              <tr className="border-b border-border/50">
                                <td className="py-2 pr-4 text-muted-foreground">Total Length ({flowUnit})</td>
                                <td className="text-right py-2 px-4 font-semibold" data-testid="text-before-total">{beforeTotalLength.toFixed(1)}</td>
                                <td className="text-right py-2 px-4 font-semibold" data-testid="text-after-total">{afterTotalLength.toFixed(1)}</td>
                                <td className="text-right py-2 pl-4 text-muted-foreground">{(afterTotalLength - beforeTotalLength) >= 0 ? '+' : ''}{(afterTotalLength - beforeTotalLength).toFixed(1)}</td>
                              </tr>
                              <tr className="border-b border-border/50">
                                <td className="py-2 pr-4 text-muted-foreground">Min Length ({flowUnit})</td>
                                <td className="text-right py-2 px-4" data-testid="text-before-min">{beforeStats.min.toFixed(1)}</td>
                                <td className="text-right py-2 px-4" data-testid="text-after-min">{afterStats.min.toFixed(1)}</td>
                                <td className="text-right py-2 pl-4 text-muted-foreground">{(afterStats.min - beforeStats.min) >= 0 ? '+' : ''}{(afterStats.min - beforeStats.min).toFixed(1)}</td>
                              </tr>
                              <tr className="border-b border-border/50">
                                <td className="py-2 pr-4 text-muted-foreground">Max Length ({flowUnit})</td>
                                <td className="text-right py-2 px-4" data-testid="text-before-max">{beforeStats.max.toFixed(1)}</td>
                                <td className="text-right py-2 px-4" data-testid="text-after-max">{afterStats.max.toFixed(1)}</td>
                                <td className="text-right py-2 pl-4 text-muted-foreground">{(afterStats.max - beforeStats.max) >= 0 ? '+' : ''}{(afterStats.max - beforeStats.max).toFixed(1)}</td>
                              </tr>
                              <tr className="border-b border-border/50">
                                <td className="py-2 pr-4 text-muted-foreground">Mean Length ({flowUnit})</td>
                                <td className="text-right py-2 px-4" data-testid="text-before-mean">{beforeStats.mean.toFixed(1)}</td>
                                <td className="text-right py-2 px-4" data-testid="text-after-mean">{afterStats.mean.toFixed(1)}</td>
                                <td className="text-right py-2 pl-4 text-muted-foreground">{(afterStats.mean - beforeStats.mean) >= 0 ? '+' : ''}{(afterStats.mean - beforeStats.mean).toFixed(1)}</td>
                              </tr>
                              <tr>
                                <td className="py-2 pr-4 text-muted-foreground">Std Dev ({flowUnit})</td>
                                <td className="text-right py-2 px-4" data-testid="text-before-std">{beforeStats.stdDev.toFixed(1)}</td>
                                <td className="text-right py-2 px-4" data-testid="text-after-std">{afterStats.stdDev.toFixed(1)}</td>
                                <td className="text-right py-2 pl-4 text-muted-foreground">{(afterStats.stdDev - beforeStats.stdDev) >= 0 ? '+' : ''}{(afterStats.stdDev - beforeStats.stdDev).toFixed(1)}</td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      </CardContent>
                    </Card>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                      <div className="space-y-4">
                        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Original Model</h4>
                        <Card data-testid="card-length-distribution-original">
                          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">Conduit Length Distribution ({flowUnit})</CardTitle>
                            <BarChart3 className="h-4 w-4 text-muted-foreground" />
                          </CardHeader>
                          <CardContent>
                            <ResponsiveContainer width="100%" height={200}>
                              <BarChart data={beforeHist}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey="range" tick={{ fontSize: 9 }} />
                                <YAxis />
                                <RechartsTooltip />
                                <Bar dataKey="count" name="Conduits" fill="hsl(210, 85%, 50%)" />
                              </BarChart>
                            </ResponsiveContainer>
                          </CardContent>
                        </Card>
                        <Card data-testid="card-cfl-distribution-original">
                          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">CFL Time Step Distribution (s)</CardTitle>
                            <Info className="h-4 w-4 text-muted-foreground" />
                          </CardHeader>
                          <CardContent>
                            <ResponsiveContainer width="100%" height={200}>
                              <BarChart data={cflBeforeHist}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey="range" tick={{ fontSize: 9 }} />
                                <YAxis />
                                <RechartsTooltip />
                                <Bar dataKey="count" name="Conduits" fill="hsl(35, 90%, 50%)" />
                              </BarChart>
                            </ResponsiveContainer>
                          </CardContent>
                        </Card>
                      </div>
                      <div className="space-y-4">
                        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Discretized Model</h4>
                        <Card data-testid="card-length-distribution-discretized">
                          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">Conduit Length Distribution ({flowUnit})</CardTitle>
                            <BarChart3 className="h-4 w-4 text-muted-foreground" />
                          </CardHeader>
                          <CardContent>
                            <ResponsiveContainer width="100%" height={200}>
                              <BarChart data={afterHist}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey="range" tick={{ fontSize: 9 }} />
                                <YAxis />
                                <RechartsTooltip />
                                <Bar dataKey="count" name="Conduits" fill="hsl(142, 60%, 40%)" />
                              </BarChart>
                            </ResponsiveContainer>
                          </CardContent>
                        </Card>
                        <Card data-testid="card-cfl-distribution-discretized">
                          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">CFL Time Step Distribution (s)</CardTitle>
                            <Info className="h-4 w-4 text-muted-foreground" />
                          </CardHeader>
                          <CardContent>
                            <ResponsiveContainer width="100%" height={200}>
                              <BarChart data={cflAfterHist}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey="range" tick={{ fontSize: 9 }} />
                                <YAxis />
                                <RechartsTooltip />
                                <Bar dataKey="count" name="Conduits" fill="hsl(270, 60%, 55%)" />
                              </BarChart>
                            </ResponsiveContainer>
                          </CardContent>
                        </Card>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 flex-wrap">
                      <Button onClick={handleDownload} data-testid="button-download-reswmm">
                        <Download className="h-4 w-4 mr-2" />
                        Download ReSWMM_{fileName.replace(/\.inp$/i, '')}.inp
                      </Button>
                    </div>

                    <Separator className="my-6" />

                    <h3 className="text-lg font-semibold mb-4" data-testid="text-run-heading">Run and Compare Simulations</h3>
                    <p className="text-sm text-muted-foreground mb-4">
                      Run SWMM on the original and discretized models to compare simulation results side by side.
                    </p>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      <Card data-testid="card-run-before">
                        <CardContent className="p-4 space-y-3">
                          <div>
                            <p className="text-sm font-medium">Original Model</p>
                            <p className="text-xs text-muted-foreground">{fileName} — {result.stats.originalConduitCount} conduits</p>
                          </div>
                          {(beforeRunState === 'uploading' || beforeRunState === 'processing') ? (
                            <div className="flex items-center gap-2">
                              <Loader2 className="h-4 w-4 animate-spin text-primary" />
                              <span className="text-sm text-muted-foreground" data-testid="text-before-run-progress">{beforeRunProgress}</span>
                            </div>
                          ) : beforeRunState === 'completed' && beforeRunResults.length > 0 ? (
                            <div className="flex items-center gap-2 flex-wrap">
                              <Badge variant="default" data-testid="badge-before-run-done">
                                {beforeRunResults[0].status === 'success' ? 'Success' : 'Failed'}
                              </Badge>
                              <span className="text-xs text-muted-foreground">{beforeRunElapsed}</span>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setShowingResults('before')}
                                data-testid="button-view-before-results"
                              >
                                View Results
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={handleRunBefore}
                                data-testid="button-rerun-before"
                              >
                                Re-run
                              </Button>
                            </div>
                          ) : (
                            <Button onClick={handleRunBefore} data-testid="button-run-before">
                              <Play className="h-4 w-4 mr-1.5" />
                              Run Original
                            </Button>
                          )}
                        </CardContent>
                      </Card>

                      <Card data-testid="card-run-after">
                        <CardContent className="p-4 space-y-3">
                          <div>
                            <p className="text-sm font-medium">Discretized Model</p>
                            <p className="text-xs text-muted-foreground">ReSWMM_{fileName.replace(/\.inp$/i, '')}.inp — {result.stats.newConduitCount} conduits</p>
                          </div>
                          {(afterRunState === 'uploading' || afterRunState === 'processing') ? (
                            <div className="flex items-center gap-2">
                              <Loader2 className="h-4 w-4 animate-spin text-primary" />
                              <span className="text-sm text-muted-foreground" data-testid="text-after-run-progress">{afterRunProgress}</span>
                            </div>
                          ) : afterRunState === 'completed' && afterRunResults.length > 0 ? (
                            <div className="flex items-center gap-2 flex-wrap">
                              <Badge variant="default" data-testid="badge-after-run-done">
                                {afterRunResults[0].status === 'success' ? 'Success' : 'Failed'}
                              </Badge>
                              <span className="text-xs text-muted-foreground">{afterRunElapsed}</span>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setShowingResults('after')}
                                data-testid="button-view-after-results"
                              >
                                View Results
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={handleRunAfter}
                                data-testid="button-rerun-after"
                              >
                                Re-run
                              </Button>
                            </div>
                          ) : (
                            <Button onClick={handleRunAfter} data-testid="button-run-after">
                              <Play className="h-4 w-4 mr-1.5" />
                              Run Discretized
                            </Button>
                          )}
                        </CardContent>
                      </Card>
                    </div>

                    {beforeRunState === 'completed' && afterRunState === 'completed' &&
                     beforeRunResults.length > 0 && afterRunResults.length > 0 && (
                      <SimulationComparison
                        beforeResult={beforeRunResults[0]}
                        afterResult={afterRunResults[0]}
                        beforeElapsed={beforeRunElapsed}
                        afterElapsed={afterRunElapsed}
                        beforeLabel={fileName}
                        afterLabel={`ReSWMM_${fileName.replace(/\.inp$/i, '')}.inp`}
                      />
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
