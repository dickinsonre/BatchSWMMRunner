import { useState, useMemo, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Film, Download, X } from "lucide-react";
import { parseTimeSeries, type ParsedTimeSeries } from "@/lib/parseTimeSeries";
import { parseInpFile } from "@/lib/inpParser";
import type { EngineRun } from "@/lib/engineComparison";
import {
  makeMapGif, makeChartGif, extractMapGeometry, buildValueLookup, GifCancelledError,
} from "@/lib/gifMaker";
import { useToast } from "@/hooks/use-toast";

interface GifMakerToolProps {
  runs: EngineRun[];
  /** Ask the parent to fetch report + inp content for this file across all runs. */
  onLoadFile: (fileName: string) => Promise<void>;
}

type GifKind = "map" | "chart";

function sectionsFor(run: EngineRun, fileName: string): ParsedTimeSeries[] {
  const result = run.results.find(r => r.fileName === fileName);
  const content = (result as any)?.reportContent as string | undefined;
  return content ? parseTimeSeries(content) : [];
}

export default function GifMakerTool({ runs, onLoadFile }: GifMakerToolProps) {
  const { toast } = useToast();

  const fileNames = useMemo(() => {
    const seen = new Set<string>();
    for (const run of runs) {
      for (const r of run.results) {
        if (r.status === "success") seen.add(r.fileName);
      }
    }
    return Array.from(seen);
  }, [runs]);

  const [fileName, setFileName] = useState<string>(fileNames[0] || "");
  const [kind, setKind] = useState<GifKind>("map");
  const [metric, setMetric] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [gifUrl, setGifUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!fileName && fileNames.length > 0) setFileName(fileNames[0]);
  }, [fileNames, fileName]);

  // Make sure content for the chosen file is loaded in every run.
  useEffect(() => {
    if (!fileName) return;
    let stale = false;
    setLoading(true);
    onLoadFile(fileName).finally(() => { if (!stale) setLoading(false); });
    return () => { stale = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileName]);

  // Revoke old object URLs.
  useEffect(() => () => { if (gifUrl) URL.revokeObjectURL(gifUrl); }, [gifUrl]);

  const perRunSections = useMemo(
    () => runs.map(run => ({ label: run.label, sections: sectionsFor(run, fileName) })),
    [runs, fileName],
  );

  // Metric options depend on the animation style.
  const metricOptions = useMemo(() => {
    const wanted = kind === "map" ? /node/i : /system/i;
    const seen = new Map<string, string>();
    for (const e of perRunSections) {
      for (const s of e.sections) {
        if (!wanted.test(s.title)) continue;
        s.columns.forEach((col, ci) => {
          const allZero = s.data.every(d => (d.values[ci] ?? 0) === 0);
          if (!allZero && !seen.has(col)) seen.set(col, s.units[ci] || "");
        });
      }
    }
    return Array.from(seen.entries()).map(([name, unit]) => ({ name, unit }));
  }, [perRunSections, kind]);

  useEffect(() => {
    if (metricOptions.length > 0 && !metricOptions.some(m => m.name === metric)) {
      const preferred = kind === "map"
        ? metricOptions.find(m => /depth/i.test(m.name)) || metricOptions[0]
        : metricOptions.find(m => /outflow|runoff|inflow/i.test(m.name)) || metricOptions[0];
      setMetric(preferred.name);
    }
  }, [metricOptions, metric, kind]);

  const inpContent = useMemo(() => {
    for (const run of runs) {
      const r = run.results.find(res => res.fileName === fileName) as any;
      if (r?.inpContent) return r.inpContent as string;
    }
    return null;
  }, [runs, fileName]);

  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Abort any in-flight GIF job when the tool unmounts.
  useEffect(() => () => { abortRef.current?.abort(); }, []);

  const handleCancel = () => {
    abortRef.current?.abort();
  };

  const handleMake = async () => {
    if (!fileName || !metric) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setGifUrl(null);
    setProgress(null);
    try {
      const unit = metricOptions.find(m => m.name === metric)?.unit || "";
      let blob: Blob;
      if (kind === "map") {
        if (!inpContent) throw new Error("The model file contents aren't available to draw the map from.");
        const geometry = extractMapGeometry(parseInpFile(inpContent));
        const engines = perRunSections
          .map(e => {
            const nodeSections = e.sections.filter(s => /node/i.test(s.title));
            const { lookup } = buildValueLookup(nodeSections, metric);
            return { label: e.label, lookup };
          })
          .filter(e => e.lookup.size > 0);
        if (engines.length === 0) throw new Error("No node time-series data found. Re-run the models to include time series.");
        blob = await makeMapGif({
          fileName, geometry, metric, unit, engines,
          onProgress: (done, total) => setProgress({ done, total }),
          signal: controller.signal,
        });
      } else {
        const engines = perRunSections.map(e => ({
          label: e.label,
          series: e.sections.find(s => /system/i.test(s.title)) || null,
        }));
        blob = await makeChartGif({
          fileName, metric, unit, engines,
          onProgress: (done, total) => setProgress({ done, total }),
          signal: controller.signal,
        });
      }
      setGifUrl(URL.createObjectURL(blob));
    } catch (e) {
      if (e instanceof GifCancelledError) return; // user cancelled — reset quietly
      toast({
        title: "Couldn't make the GIF",
        description: e instanceof Error ? e.message : "Something went wrong while drawing frames.",
        variant: "destructive",
      });
    } finally {
      abortRef.current = null;
      setBusy(false);
      setProgress(null);
    }
  };

  if (fileNames.length === 0) return null;
  const downloadName = `${fileName.replace(/\.inp$/i, "")}-${kind}-${metric.replace(/\W+/g, "_")}.gif`;

  return (
    <Card data-testid="card-gif-maker">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Film className="h-5 w-5" />
          Make a GIF
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Turn the results into a shareable animation — the network map lighting up over time, or a chart drawing itself.{runs.length > 1 ? " Engines are shown side by side." : ""}
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Select value={fileName} onValueChange={setFileName}>
            <SelectTrigger className="w-[260px]" data-testid="select-gif-file">
              <SelectValue placeholder="Choose a model" />
            </SelectTrigger>
            <SelectContent>
              {fileNames.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={kind} onValueChange={v => setKind(v as GifKind)}>
            <SelectTrigger className="w-[220px]" data-testid="select-gif-kind">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="map">Animated network map</SelectItem>
              <SelectItem value="chart">Animated system chart</SelectItem>
            </SelectContent>
          </Select>
          <Select value={metric} onValueChange={setMetric} disabled={metricOptions.length === 0}>
            <SelectTrigger className="w-[220px]" data-testid="select-gif-metric">
              <SelectValue placeholder="Choose a metric" />
            </SelectTrigger>
            <SelectContent>
              {metricOptions.map(m => (
                <SelectItem key={m.name} value={m.name}>
                  {m.name}{m.unit ? ` (${m.unit})` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={handleMake} disabled={busy || loading || !metric} data-testid="button-make-gif">
            {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Film className="h-4 w-4 mr-2" />}
            {busy
              ? progress ? `Drawing frame ${progress.done}/${progress.total}…` : "Preparing…"
              : "Make GIF"}
          </Button>
          {busy && (
            <Button variant="outline" onClick={handleCancel} data-testid="button-cancel-gif">
              <X className="h-4 w-4 mr-2" />
              Cancel
            </Button>
          )}
        </div>

        {loading && (
          <p className="text-xs text-muted-foreground">Loading results for this model…</p>
        )}
        {!loading && metricOptions.length === 0 && (
          <p className="text-xs text-muted-foreground" data-testid="text-gif-no-data">
            No {kind === "map" ? "node" : "system"} time-series data found for this model. Results from before the latest update may need to be re-run.
          </p>
        )}

        {gifUrl && (
          <div className="space-y-2" data-testid="gif-preview">
            <img src={gifUrl} alt={`Animation of ${metric} for ${fileName}`} className="rounded-md border max-w-full" />
            <Button asChild variant="outline" size="sm" data-testid="button-download-gif">
              <a href={gifUrl} download={downloadName}>
                <Download className="h-4 w-4 mr-2" />
                Download GIF
              </a>
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
