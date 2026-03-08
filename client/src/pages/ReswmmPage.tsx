import { useState, useCallback, useMemo, useRef } from "react";
import { Upload, Download, Scissors, BarChart3, ArrowRight, AlertTriangle, Info } from "lucide-react";
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
  ResponsiveContainer,
} from "recharts";

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

export default function ReswmmPage() {
  const [fileName, setFileName] = useState<string>('');
  const [originalContent, setOriginalContent] = useState<string>('');
  const [parsed, setParsed] = useState<ParsedInpFile | null>(null);
  const [config, setConfig] = useState<ReswmmConfig>(DEFAULT_RESWMM_CONFIG);
  const [result, setResult] = useState<DiscretizedResult | null>(null);
  const [cflBefore, setCflBefore] = useState<CflAnalysis[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
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
      const diameter = xs ? xs.geom1 : 1;
      const celerity = Math.sqrt(g * diameter);
      const standardTs = celerity > 0 ? c.length / celerity : 999;
      return { conduitName: c.name, length: c.length, diameter, standardTimeStep: standardTs, conservativeTimeStep: standardTs * 0.10 };
    });
  }, [result, parsed]);

  const cflAfterHist = useMemo(() => {
    const vals = cflAfterAnalysis.map(c => c.standardTimeStep).filter(v => isFinite(v));
    return buildHistogram(vals, 12);
  }, [cflAfterAnalysis]);

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

                  <Button onClick={handleDiscretize} data-testid="button-discretize">
                    <Scissors className="h-4 w-4 mr-2" />
                    Discretize
                  </Button>
                </CardContent>
              </Card>

              {result && (
                <>
                  <Separator />

                  <div>
                    <h3 className="text-lg font-semibold mb-4" data-testid="text-results-heading">Discretization Results</h3>

                    <Card className="mb-4" data-testid="card-summary">
                      <CardContent className="p-4">
                        <p className="text-sm" data-testid="text-summary">
                          {result.stats.splitCount} conduit{result.stats.splitCount !== 1 ? 's' : ''} split into {result.stats.newConduitCount} segments, {result.stats.newJunctionCount} new junction{result.stats.newJunctionCount !== 1 ? 's' : ''} added.
                        </p>
                      </CardContent>
                    </Card>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                      <Card data-testid="card-before">
                        <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
                          <CardTitle className="text-sm font-medium">Before</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-2 text-sm">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Conduits</span>
                            <span data-testid="text-before-conduits">{result.stats.originalConduitCount}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Junctions</span>
                            <span data-testid="text-before-junctions">{parsed.counts.junctions}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Min Length</span>
                            <span data-testid="text-before-min">{beforeStats.min.toFixed(1)} {flowUnit}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Max Length</span>
                            <span data-testid="text-before-max">{beforeStats.max.toFixed(1)} {flowUnit}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Mean Length</span>
                            <span data-testid="text-before-mean">{beforeStats.mean.toFixed(1)} {flowUnit}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Std Dev</span>
                            <span data-testid="text-before-std">{beforeStats.stdDev.toFixed(1)} {flowUnit}</span>
                          </div>
                        </CardContent>
                      </Card>

                      <Card data-testid="card-after">
                        <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
                          <CardTitle className="text-sm font-medium">After</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-2 text-sm">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Conduits</span>
                            <span data-testid="text-after-conduits">{result.stats.newConduitCount}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Junctions</span>
                            <span data-testid="text-after-junctions">{parsed.counts.junctions + result.stats.newJunctionCount}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Min Length</span>
                            <span data-testid="text-after-min">{afterStats.min.toFixed(1)} {flowUnit}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Max Length</span>
                            <span data-testid="text-after-max">{afterStats.max.toFixed(1)} {flowUnit}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Mean Length</span>
                            <span data-testid="text-after-mean">{afterStats.mean.toFixed(1)} {flowUnit}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Std Dev</span>
                            <span data-testid="text-after-std">{afterStats.stdDev.toFixed(1)} {flowUnit}</span>
                          </div>
                        </CardContent>
                      </Card>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                      <Card data-testid="card-length-distribution-after-before">
                        <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
                          <CardTitle className="text-sm font-medium">Before - Length Distribution</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <ResponsiveContainer width="100%" height={180}>
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

                      <Card data-testid="card-length-distribution-after">
                        <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
                          <CardTitle className="text-sm font-medium">After - Length Distribution</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <ResponsiveContainer width="100%" height={180}>
                            <BarChart data={afterHist}>
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

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                      <Card data-testid="card-cfl-before">
                        <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
                          <CardTitle className="text-sm font-medium">Before - CFL Time Steps (s)</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <ResponsiveContainer width="100%" height={180}>
                            <BarChart data={cflBeforeHist}>
                              <CartesianGrid strokeDasharray="3 3" />
                              <XAxis dataKey="range" tick={{ fontSize: 10 }} />
                              <YAxis />
                              <RechartsTooltip />
                              <Bar dataKey="count" fill="hsl(35, 90%, 50%)" />
                            </BarChart>
                          </ResponsiveContainer>
                        </CardContent>
                      </Card>

                      <Card data-testid="card-cfl-after">
                        <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
                          <CardTitle className="text-sm font-medium">After - CFL Time Steps (s)</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <ResponsiveContainer width="100%" height={180}>
                            <BarChart data={cflAfterHist}>
                              <CartesianGrid strokeDasharray="3 3" />
                              <XAxis dataKey="range" tick={{ fontSize: 10 }} />
                              <YAxis />
                              <RechartsTooltip />
                              <Bar dataKey="count" fill="hsl(270, 60%, 55%)" />
                            </BarChart>
                          </ResponsiveContainer>
                        </CardContent>
                      </Card>
                    </div>

                    <Button onClick={handleDownload} data-testid="button-download-reswmm">
                      <Download className="h-4 w-4 mr-2" />
                      Download ReSWMM_{fileName.replace(/\.inp$/i, '')}.inp
                    </Button>
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
