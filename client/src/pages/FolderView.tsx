import { useState, useCallback, useMemo, useRef } from "react";
import { FolderOpen, Upload, FileText, X, BarChart3, Network, Settings2, CircleDot, Triangle, Square, Droplets, MapPin, Activity, Pipette } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import AppHeader from "@/components/AppHeader";
import { parseInpFile, type ParsedInpFile } from "@/lib/inpParser";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Cell } from "recharts";

interface LoadedFile {
  id: string;
  name: string;
  content: string;
  parsed: ParsedInpFile;
}

function computeLengthStats(lengths: number[]) {
  if (lengths.length === 0) return { min: 0, max: 0, mean: 0, stdDev: 0 };
  const min = Math.min(...lengths);
  const max = Math.max(...lengths);
  const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  const variance = lengths.reduce((sum, v) => sum + (v - mean) ** 2, 0) / lengths.length;
  const stdDev = Math.sqrt(variance);
  return { min, max, mean, stdDev };
}

function buildHistogramData(lengths: number[], binCount = 15) {
  if (lengths.length === 0) return [];
  const min = Math.min(...lengths);
  const max = Math.max(...lengths);
  if (min === max) return [{ range: `${min.toFixed(0)}`, count: lengths.length }];
  const binWidth = (max - min) / binCount;
  const bins: { range: string; count: number }[] = [];
  for (let i = 0; i < binCount; i++) {
    const lo = min + i * binWidth;
    const hi = lo + binWidth;
    const count = lengths.filter(l => (i === binCount - 1) ? (l >= lo && l <= hi) : (l >= lo && l < hi)).length;
    bins.push({ range: `${lo.toFixed(0)}`, count });
  }
  return bins;
}

function NetworkMap({ parsed }: { parsed: ParsedInpFile }) {
  const coordMap = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    for (const c of parsed.coordinates) {
      map.set(c.node, { x: c.x, y: c.y });
    }
    return map;
  }, [parsed.coordinates]);

  const junctionSet = useMemo(() => new Set(parsed.junctions.map(j => j.name)), [parsed.junctions]);
  const outfallSet = useMemo(() => new Set(parsed.outfalls.map(o => o.name)), [parsed.outfalls]);
  const storageSet = useMemo(() => new Set(parsed.storage.map(s => s.name)), [parsed.storage]);

  if (coordMap.size === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
        No coordinate data available for network map
      </div>
    );
  }

  const allX = Array.from(coordMap.values()).map(c => c.x);
  const allY = Array.from(coordMap.values()).map(c => c.y);
  const minX = Math.min(...allX);
  const maxX = Math.max(...allX);
  const minY = Math.min(...allY);
  const maxY = Math.max(...allY);

  const padding = 30;
  const svgWidth = 500;
  const svgHeight = 400;
  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;
  const scaleX = (svgWidth - 2 * padding) / rangeX;
  const scaleY = (svgHeight - 2 * padding) / rangeY;
  const scale = Math.min(scaleX, scaleY);

  const toSvg = (x: number, y: number) => ({
    sx: padding + (x - minX) * scale,
    sy: svgHeight - padding - (y - minY) * scale,
  });

  const allLinks = [
    ...parsed.conduits.map(c => ({ from: c.from, to: c.to, type: 'conduit' as const })),
    ...parsed.pumps.map(p => ({ from: p.from, to: p.to, type: 'pump' as const })),
    ...parsed.weirs.map(w => ({ from: w.from, to: w.to, type: 'weir' as const })),
    ...parsed.orifices.map(o => ({ from: o.from, to: o.to, type: 'orifice' as const })),
  ];

  return (
    <div className="w-full overflow-auto">
      <svg
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        className="w-full h-auto"
        style={{ maxHeight: 400 }}
        data-testid="svg-network-map"
      >
        <rect width={svgWidth} height={svgHeight} fill="none" />
        {allLinks.map((link, i) => {
          const fromCoord = coordMap.get(link.from);
          const toCoord = coordMap.get(link.to);
          if (!fromCoord || !toCoord) return null;
          const f = toSvg(fromCoord.x, fromCoord.y);
          const t = toSvg(toCoord.x, toCoord.y);
          const color = link.type === 'conduit' ? 'hsl(var(--muted-foreground))' :
                        link.type === 'pump' ? 'hsl(var(--primary))' : 'hsl(var(--accent-foreground))';
          return (
            <line
              key={`link-${i}`}
              x1={f.sx} y1={f.sy} x2={t.sx} y2={t.sy}
              stroke={color}
              strokeWidth={1.5}
              strokeOpacity={0.6}
            />
          );
        })}
        {Array.from(coordMap.entries()).map(([name, coord]) => {
          const { sx, sy } = toSvg(coord.x, coord.y);
          let fill = 'hsl(210, 70%, 50%)';
          let r = 3;
          if (outfallSet.has(name)) {
            fill = 'hsl(140, 60%, 45%)';
            r = 5;
          } else if (storageSet.has(name)) {
            fill = 'hsl(30, 80%, 55%)';
            r = 4;
          }
          return (
            <circle
              key={`node-${name}`}
              cx={sx} cy={sy} r={r}
              fill={fill}
              stroke="none"
            >
              <title>{name}</title>
            </circle>
          );
        })}
      </svg>
      <div className="flex items-center gap-4 justify-center mt-2 text-xs text-muted-foreground flex-wrap">
        <span className="flex items-center gap-1">
          <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: 'hsl(210, 70%, 50%)' }} />
          Junctions
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: 'hsl(140, 60%, 45%)' }} />
          Outfalls
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: 'hsl(30, 80%, 55%)' }} />
          Storage
        </span>
      </div>
    </div>
  );
}

function StatCard({ label, value, icon }: { label: string; value: number | string; icon: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-center gap-2">
          <div className="text-muted-foreground">{icon}</div>
          <div>
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-lg font-semibold" data-testid={`text-stat-${label.toLowerCase().replace(/\s+/g, '-')}`}>{value}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function FileDetailPanel({ file }: { file: LoadedFile }) {
  const { parsed } = file;
  const lengths = parsed.conduits.map(c => c.length);
  const stats = computeLengthStats(lengths);
  const histData = buildHistogramData(lengths);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold mb-1" data-testid="text-detail-filename">{file.name}</h3>
        {parsed.title && (
          <p className="text-sm text-muted-foreground" data-testid="text-detail-title">{parsed.title}</p>
        )}
      </div>

      <div>
        <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
          <BarChart3 className="h-4 w-4" />
          Element Counts
        </h4>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <StatCard label="Junctions" value={parsed.counts.junctions} icon={<CircleDot className="h-4 w-4" />} />
          <StatCard label="Conduits" value={parsed.counts.conduits} icon={<Activity className="h-4 w-4" />} />
          <StatCard label="Subcatchments" value={parsed.counts.subcatchments} icon={<Droplets className="h-4 w-4" />} />
          <StatCard label="Outfalls" value={parsed.counts.outfalls} icon={<Triangle className="h-4 w-4" />} />
          <StatCard label="Storage" value={parsed.counts.storage} icon={<Square className="h-4 w-4" />} />
          <StatCard label="Pumps" value={parsed.counts.pumps} icon={<Pipette className="h-4 w-4" />} />
          <StatCard label="Orifices" value={parsed.counts.orifices} icon={<Settings2 className="h-4 w-4" />} />
          <StatCard label="Weirs" value={parsed.counts.weirs} icon={<Activity className="h-4 w-4" />} />
          <StatCard label="Rain Gages" value={parsed.counts.raingages} icon={<Droplets className="h-4 w-4" />} />
        </div>
      </div>

      <Separator />

      <div>
        <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
          <Settings2 className="h-4 w-4" />
          Network Options
        </h4>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Card>
            <CardContent className="p-3">
              <p className="text-xs text-muted-foreground">Flow Units</p>
              <p className="font-medium" data-testid="text-flow-units">{parsed.options.flowUnits || 'N/A'}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3">
              <p className="text-xs text-muted-foreground">Routing Method</p>
              <p className="font-medium" data-testid="text-routing-method">{parsed.options.routingMethod || 'N/A'}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3">
              <p className="text-xs text-muted-foreground">Infiltration</p>
              <p className="font-medium" data-testid="text-infiltration">{parsed.options.infiltrationMethod || 'N/A'}</p>
            </CardContent>
          </Card>
        </div>
      </div>

      <Separator />

      <div>
        <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
          <Network className="h-4 w-4" />
          Network Map
        </h4>
        <Card>
          <CardContent className="p-4">
            <NetworkMap parsed={parsed} />
          </CardContent>
        </Card>
      </div>

      {lengths.length > 0 && (
        <>
          <Separator />
          <div>
            <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              Conduit Length Statistics
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <Card>
                <CardContent className="p-3">
                  <p className="text-xs text-muted-foreground">Min Length</p>
                  <p className="font-medium" data-testid="text-length-min">{stats.min.toFixed(1)}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3">
                  <p className="text-xs text-muted-foreground">Max Length</p>
                  <p className="font-medium" data-testid="text-length-max">{stats.max.toFixed(1)}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3">
                  <p className="text-xs text-muted-foreground">Mean Length</p>
                  <p className="font-medium" data-testid="text-length-mean">{stats.mean.toFixed(1)}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3">
                  <p className="text-xs text-muted-foreground">Std Dev</p>
                  <p className="font-medium" data-testid="text-length-stddev">{stats.stdDev.toFixed(1)}</p>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardContent className="p-4">
                <p className="text-sm font-medium mb-3">Conduit Length Distribution</p>
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={histData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis
                      dataKey="range"
                      tick={{ fontSize: 10 }}
                      stroke="hsl(var(--muted-foreground))"
                      label={{ value: 'Length', position: 'insideBottom', offset: -2, fontSize: 11 }}
                    />
                    <YAxis
                      tick={{ fontSize: 10 }}
                      stroke="hsl(var(--muted-foreground))"
                      label={{ value: 'Count', angle: -90, position: 'insideLeft', fontSize: 11 }}
                    />
                    <RechartsTooltip
                      contentStyle={{
                        backgroundColor: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: 6,
                        fontSize: 12,
                      }}
                    />
                    <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                      {histData.map((_entry, index) => (
                        <Cell key={`cell-${index}`} fill="hsl(var(--primary))" fillOpacity={0.8} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function ComparePanel({ files }: { files: LoadedFile[] }) {
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold" data-testid="text-compare-title">
        Comparing {files.length} Files
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="text-left p-2 font-medium">Metric</th>
              {files.map(f => (
                <th key={f.id} className="text-right p-2 font-medium">{f.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[
              { label: 'Junctions', key: 'junctions' as const },
              { label: 'Conduits', key: 'conduits' as const },
              { label: 'Subcatchments', key: 'subcatchments' as const },
              { label: 'Outfalls', key: 'outfalls' as const },
              { label: 'Storage', key: 'storage' as const },
              { label: 'Pumps', key: 'pumps' as const },
              { label: 'Orifices', key: 'orifices' as const },
              { label: 'Weirs', key: 'weirs' as const },
              { label: 'Rain Gages', key: 'raingages' as const },
            ].map(row => (
              <tr key={row.key} className="border-b">
                <td className="p-2 text-muted-foreground">{row.label}</td>
                {files.map(f => (
                  <td key={f.id} className="text-right p-2 font-medium">{f.parsed.counts[row.key]}</td>
                ))}
              </tr>
            ))}
            <tr className="border-b">
              <td className="p-2 text-muted-foreground">Flow Units</td>
              {files.map(f => (
                <td key={f.id} className="text-right p-2">
                  <Badge variant="secondary">{f.parsed.options.flowUnits || 'N/A'}</Badge>
                </td>
              ))}
            </tr>
            <tr className="border-b">
              <td className="p-2 text-muted-foreground">Routing</td>
              {files.map(f => (
                <td key={f.id} className="text-right p-2">
                  <Badge variant="secondary">{f.parsed.options.routingMethod || 'N/A'}</Badge>
                </td>
              ))}
            </tr>
            <tr className="border-b">
              <td className="p-2 text-muted-foreground">Avg Conduit Length</td>
              {files.map(f => {
                const ls = f.parsed.conduits.map(c => c.length);
                const avg = ls.length > 0 ? (ls.reduce((a, b) => a + b, 0) / ls.length) : 0;
                return <td key={f.id} className="text-right p-2 font-medium">{avg.toFixed(1)}</td>;
              })}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function FolderView() {
  const [loadedFiles, setLoadedFiles] = useState<LoadedFile[]>([]);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [selectedForCompare, setSelectedForCompare] = useState<Set<string>>(new Set());
  const [compareMode, setCompareMode] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dirInputRef = useRef<HTMLInputElement>(null);

  const loadFiles = useCallback(async (fileList: FileList) => {
    const inpFiles = Array.from(fileList).filter(f => f.name.toLowerCase().endsWith('.inp'));
    const newFiles: LoadedFile[] = [];

    for (const file of inpFiles) {
      const content = await file.text();
      const parsed = parseInpFile(content);
      newFiles.push({
        id: `${Date.now()}-${file.name}-${Math.random().toString(36).slice(2, 7)}`,
        name: file.name,
        content,
        parsed,
      });
    }

    setLoadedFiles(prev => [...prev, ...newFiles]);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      loadFiles(e.dataTransfer.files);
    }
  }, [loadFiles]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const handleRemoveFile = (id: string) => {
    setLoadedFiles(prev => prev.filter(f => f.id !== id));
    if (selectedFileId === id) setSelectedFileId(null);
    setSelectedForCompare(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const handleClearAll = () => {
    setLoadedFiles([]);
    setSelectedFileId(null);
    setSelectedForCompare(new Set());
    setCompareMode(false);
  };

  const toggleCompareSelect = (id: string) => {
    setSelectedForCompare(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const selectedFile = loadedFiles.find(f => f.id === selectedFileId) || null;
  const compareFiles = loadedFiles.filter(f => selectedForCompare.has(f.id));

  const totalElements = (f: LoadedFile) => {
    const c = f.parsed.counts;
    return c.junctions + c.conduits + c.subcatchments + c.outfalls + c.storage + c.pumps + c.orifices + c.weirs;
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <AppHeader />

      <main className="container max-w-6xl mx-auto px-8 py-8 flex-1">
        {loadedFiles.length === 0 ? (
          <Card
            className="border-2 border-dashed p-8 hover-elevate"
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            data-testid="card-folder-upload-zone"
          >
            <div className="flex flex-col items-center gap-4 text-center">
              <div className="rounded-full bg-primary/10 p-4">
                <FolderOpen className="h-8 w-8 text-primary" />
              </div>
              <div>
                <h3 className="text-lg font-semibold" data-testid="text-folder-upload-title">
                  Load SWMM Input Files
                </h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Load an entire directory of .inp files or drag and drop multiple files to analyze
                </p>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <Button
                  variant="default"
                  onClick={() => dirInputRef.current?.click()}
                  data-testid="button-load-directory"
                >
                  <FolderOpen className="h-4 w-4 mr-1.5" />
                  Load Directory
                </Button>
                <Button
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  data-testid="button-browse-files"
                >
                  <Upload className="h-4 w-4 mr-1.5" />
                  Browse Files
                </Button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".inp"
                onChange={(e) => { if (e.target.files) loadFiles(e.target.files); e.target.value = ''; }}
                className="hidden"
                data-testid="input-folder-file"
              />
              <input
                ref={dirInputRef}
                type="file"
                onChange={(e) => { if (e.target.files) loadFiles(e.target.files); e.target.value = ''; }}
                className="hidden"
                data-testid="input-folder-directory"
                {...({ webkitdirectory: "", directory: "" } as React.InputHTMLAttributes<HTMLInputElement>)}
              />
            </div>
          </Card>
        ) : (
          <div className="space-y-6">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-semibold" data-testid="text-files-loaded-count">
                  {loadedFiles.length} file{loadedFiles.length !== 1 ? 's' : ''} loaded
                </h2>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => dirInputRef.current?.click()}
                  data-testid="button-add-more-files"
                >
                  <Upload className="h-3.5 w-3.5 mr-1" />
                  Add More
                </Button>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {loadedFiles.length >= 2 && (
                  <Button
                    variant={compareMode ? "default" : "outline"}
                    size="sm"
                    onClick={() => { setCompareMode(!compareMode); if (compareMode) setSelectedForCompare(new Set()); }}
                    data-testid="button-toggle-compare"
                  >
                    <BarChart3 className="h-3.5 w-3.5 mr-1" />
                    {compareMode ? 'Exit Compare' : 'Compare'}
                  </Button>
                )}
                {compareMode && selectedForCompare.size >= 2 && (
                  <Badge variant="default" data-testid="badge-compare-count">
                    {selectedForCompare.size} selected
                  </Badge>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleClearAll}
                  data-testid="button-clear-all-folder"
                >
                  <X className="h-3.5 w-3.5 mr-1" />
                  Clear All
                </Button>
              </div>
              <input
                ref={dirInputRef}
                type="file"
                onChange={(e) => { if (e.target.files) loadFiles(e.target.files); e.target.value = ''; }}
                className="hidden"
                {...({ webkitdirectory: "", directory: "" } as React.InputHTMLAttributes<HTMLInputElement>)}
              />
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".inp"
                onChange={(e) => { if (e.target.files) loadFiles(e.target.files); e.target.value = ''; }}
                className="hidden"
              />
            </div>

            <div
              className="grid grid-cols-1 lg:grid-cols-3 gap-6"
              onDrop={handleDrop}
              onDragOver={handleDragOver}
            >
              <div className="lg:col-span-1">
                <Card>
                  <CardHeader className="p-4 pb-2">
                    <CardTitle className="text-sm font-medium">Files</CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <ScrollArea className="h-[calc(100vh-320px)]">
                      <div className="p-2 space-y-1">
                        {loadedFiles.map(file => {
                          const isSelected = selectedFileId === file.id;
                          const isCompareSelected = selectedForCompare.has(file.id);
                          return (
                            <div
                              key={file.id}
                              className={`flex items-center gap-2 p-2 rounded-md cursor-pointer hover-elevate ${
                                isSelected && !compareMode ? 'bg-primary/10' : ''
                              } ${isCompareSelected && compareMode ? 'bg-primary/10' : ''}`}
                              onClick={() => {
                                if (compareMode) {
                                  toggleCompareSelect(file.id);
                                } else {
                                  setSelectedFileId(isSelected ? null : file.id);
                                }
                              }}
                              data-testid={`file-item-${file.name}`}
                            >
                              {compareMode && (
                                <div className={`w-4 h-4 rounded-sm border flex items-center justify-center flex-shrink-0 ${
                                  isCompareSelected ? 'bg-primary border-primary' : 'border-muted-foreground/40'
                                }`}>
                                  {isCompareSelected && (
                                    <svg className="w-3 h-3 text-primary-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                    </svg>
                                  )}
                                </div>
                              )}
                              <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate">{file.name}</p>
                                <p className="text-xs text-muted-foreground">
                                  {totalElements(file)} elements
                                </p>
                              </div>
                              <div className="flex items-center gap-1 flex-shrink-0">
                                <Badge variant="secondary" data-testid={`badge-conduits-${file.name}`}>
                                  {file.parsed.counts.conduits}c
                                </Badge>
                                <Badge variant="secondary" data-testid={`badge-junctions-${file.name}`}>
                                  {file.parsed.counts.junctions}j
                                </Badge>
                              </div>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    onClick={(e) => { e.stopPropagation(); handleRemoveFile(file.id); }}
                                    data-testid={`button-remove-${file.name}`}
                                  >
                                    <X className="h-3.5 w-3.5" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Remove file</TooltipContent>
                              </Tooltip>
                            </div>
                          );
                        })}
                      </div>
                    </ScrollArea>
                  </CardContent>
                </Card>
              </div>

              <div className="lg:col-span-2">
                {compareMode && compareFiles.length >= 2 ? (
                  <ComparePanel files={compareFiles} />
                ) : selectedFile ? (
                  <FileDetailPanel file={selectedFile} />
                ) : (
                  <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                    <MapPin className="h-8 w-8 mb-3 opacity-50" />
                    <p className="text-sm" data-testid="text-select-file-hint">
                      {compareMode
                        ? 'Select at least 2 files to compare'
                        : 'Select a file from the list to view details'}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </main>

      <footer className="border-t mt-auto">
        <div className="container max-w-6xl mx-auto px-8 py-4">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <p>BatchSWMM v1.0.0</p>
            <p>Folder View</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
