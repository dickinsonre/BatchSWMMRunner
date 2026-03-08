import { CheckCircle, XCircle, ChevronDown, ChevronRight, Download, Clock, FileText, Globe, BarChart3, AlertTriangle, Droplets, LayoutDashboard, FileDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import type { ParsedMetrics } from "@shared/schema";
import InteractiveCharts from "./InteractiveCharts";
import { setDashboardResults } from "@/lib/resultsStore";
import { generateAndDownloadReport, type ReportFormat } from "@/lib/reportGenerator";

const MAX_PREVIEW_LINES = 2000;

function LargeTextViewer({ content, testId }: { content: string; testId: string }) {
  const [showFull, setShowFull] = useState(false);
  const lineCount = useMemo(() => content.split('\n').length, [content]);
  const isTruncated = lineCount > MAX_PREVIEW_LINES && !showFull;
  const displayContent = isTruncated
    ? content.split('\n').slice(0, MAX_PREVIEW_LINES).join('\n')
    : content;

  return (
    <div>
      <pre className="text-xs p-4 font-mono whitespace-pre overflow-x-auto bg-muted" data-testid={testId}>
        {displayContent}
      </pre>
      {lineCount > MAX_PREVIEW_LINES && (
        <div className="flex items-center justify-center gap-3 p-3 border-t bg-muted/50">
          <span className="text-xs text-muted-foreground">
            {isTruncated
              ? `Showing first ${MAX_PREVIEW_LINES.toLocaleString()} of ${lineCount.toLocaleString()} lines`
              : `Showing all ${lineCount.toLocaleString()} lines`}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowFull(!showFull)}
            data-testid={`button-toggle-full-${testId}`}
          >
            {isTruncated ? 'Show All' : 'Show Less'}
          </Button>
        </div>
      )}
    </div>
  );
}

export interface ProcessResult {
  id: string;
  fileName: string;
  filePath: string;
  status: 'success' | 'failed';
  error?: string;
  processingTime?: number;
  reportContent?: string;
  inpContent?: string;
  results?: {
    peakFlow?: number;
    totalVolume?: number;
  };
  parsedMetrics?: ParsedMetrics;
}

interface ResultsDisplayProps {
  results: ProcessResult[];
  elapsedTime?: string;
}

function getContinuityErrorColor(error: number | undefined): string {
  if (error === undefined) return 'text-muted-foreground';
  const abs = Math.abs(error);
  if (abs <= 1) return 'text-green-600';
  if (abs <= 5) return 'text-yellow-600';
  return 'text-destructive';
}

function getContinuityErrorBadge(error: number | undefined): { variant: 'default' | 'secondary' | 'destructive' | 'outline'; label: string } {
  if (error === undefined) return { variant: 'outline', label: 'N/A' };
  const abs = Math.abs(error);
  if (abs <= 1) return { variant: 'outline', label: `${error.toFixed(3)}%` };
  if (abs <= 5) return { variant: 'secondary', label: `${error.toFixed(3)}%` };
  return { variant: 'destructive', label: `${error.toFixed(3)}%` };
}

function reportToHtml(content: string): string {
  const escaped = content
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const lines = escaped.split('\n');
  const htmlLines: string[] = [];

  const tsStartIndices = new Set<number>();
  for (let si = 0; si < lines.length; si++) {
    if (/^\s*\*{3,}\s*$/.test(lines[si]) && si + 1 < lines.length && /Time Series$/i.test(lines[si + 1].trim())) {
      tsStartIndices.add(si);
    }
  }

  let tsSkipStart = -1;
  let tsSkipEnd = -1;
  if (tsStartIndices.size > 0) {
    tsSkipStart = Math.min(...tsStartIndices);
    const lastStart = Math.max(...tsStartIndices);
    tsSkipEnd = lines.length - 1;
  }

  function splitTableRow(line: string): string[] {
    return line.trim().split(/\s{2,}/).filter(s => s !== '');
  }

  let li = 0;
  while (li < lines.length) {
    const line = lines[li];

    if (tsSkipStart >= 0 && li >= tsSkipStart && li <= tsSkipEnd) { li++; continue; }

    if (/^\s*\*{3,}/.test(line)) {
      const titleOnSameLine = line.replace(/\*/g, '').trim();
      if (titleOnSameLine) {
        const nextLine = li + 1 < lines.length ? lines[li + 1] : '';
        const nextTitle = nextLine.replace(/\*/g, '').trim();
        if (/^\s*\*{3,}\s*$/.test(nextLine) && nextTitle === '') {
          htmlLines.push(`<h2 style="color:hsl(var(--primary));margin:1.5em 0 0.4em;font-size:1.1em;font-weight:700;border-bottom:2px solid hsl(var(--primary) / 0.3);padding-bottom:0.3em;">${titleOnSameLine}</h2>`);
          li += 2;
          continue;
        }
        htmlLines.push(`<h2 style="color:hsl(var(--primary));margin:1.5em 0 0.4em;font-size:1.1em;font-weight:700;border-bottom:2px solid hsl(var(--primary) / 0.3);padding-bottom:0.3em;">${titleOnSameLine}</h2>`);
        li++;
        continue;
      }
      if (li + 2 < lines.length && /^\s*\*{3,}\s*$/.test(lines[li + 2])) {
        const sectionTitle = lines[li + 1].replace(/\*/g, '').trim();
        htmlLines.push(`<h2 style="color:hsl(var(--primary));margin:1.5em 0 0.4em;font-size:1.1em;font-weight:700;border-bottom:2px solid hsl(var(--primary) / 0.3);padding-bottom:0.3em;">${sectionTitle}</h2>`);
        li += 3;
        continue;
      }
      li++;
      continue;
    }

    if (/^\s*-{10,}/.test(line)) {
      const headerLines: string[] = [];
      let scanBack = li - 1;
      while (scanBack >= 0 && lines[scanBack].trim() !== '' && !/^\s*\*{3,}/.test(lines[scanBack]) && !/^\s*-{5,}/.test(lines[scanBack])) {
        headerLines.unshift(lines[scanBack]);
        scanBack--;
      }

      let peekIdx = li + 1;
      while (peekIdx < lines.length && lines[peekIdx].trim() === '') peekIdx++;
      const nextNonEmpty = peekIdx < lines.length ? lines[peekIdx].trim() : '';
      const hasDataAfter = nextNonEmpty !== '' && !/^\s*\*{3,}/.test(lines[peekIdx] || '') && splitTableRow(nextNonEmpty).length >= 2;

      if (!hasDataAfter || headerLines.length === 0) {
        li++;
        continue;
      }

      const removeCount = headerLines.length;
      for (let r = 0; r < removeCount; r++) {
        if (htmlLines.length > 0) htmlLines.pop();
      }

      const tableRows: string[] = [];
      tableRows.push('<div style="overflow-x:auto;margin:0.5em 0 1em;">');
      tableRows.push('<table style="border-collapse:collapse;width:100%;font-family:monospace;font-size:0.8em;">');

      if (headerLines.length > 0) {
        tableRows.push('<thead>');
        for (const hLine of headerLines) {
          const cells = splitTableRow(hLine);
          tableRows.push('<tr>');
          for (const cell of cells) {
            tableRows.push(`<th style="padding:0.3em 0.6em;text-align:left;border-bottom:2px solid hsl(var(--primary) / 0.4);font-weight:600;white-space:nowrap;color:hsl(var(--foreground) / 0.8);">${cell}</th>`);
          }
          tableRows.push('</tr>');
        }
        tableRows.push('</thead>');
      }

      tableRows.push('<tbody>');
      li++;

      let rowIdx = 0;
      while (li < lines.length) {
        const dataLine = lines[li];
        if (dataLine.trim() === '') break;
        if (/^\s*\*{3,}/.test(dataLine)) break;
        if (/^\s*-{10,}/.test(dataLine)) { li++; continue; }

        const cells = splitTableRow(dataLine);
        const bgColor = rowIdx % 2 === 0 ? 'transparent' : 'hsl(var(--muted) / 0.3)';
        tableRows.push(`<tr style="background:${bgColor};">`);

        for (let ci = 0; ci < cells.length; ci++) {
          let cellVal = cells[ci];
          const isNum = /^[-+]?\d*\.?\d+%?$/.test(cellVal);
          const align = ci === 0 ? 'left' : isNum ? 'right' : 'left';
          tableRows.push(`<td style="padding:0.3em 0.6em;text-align:${align};border-bottom:1px solid hsl(var(--border) / 0.5);white-space:nowrap;">${cellVal}</td>`);
        }
        tableRows.push('</tr>');
        rowIdx++;
        li++;
      }
      tableRows.push('</tbody></table></div>');
      htmlLines.push(tableRows.join('\n'));
      continue;
    }

    if (/EPA STORM WATER MANAGEMENT MODEL/.test(line)) {
      htmlLines.push(`<h1 style="color:hsl(var(--primary));font-size:1.3em;font-weight:700;margin-bottom:0.2em;">${line.trim()}</h1>`);
      li++; continue;
    }
    if (/EPA SWMM/.test(line)) {
      htmlLines.push(`<div style="font-weight:700;font-size:1.1em;color:hsl(var(--primary));margin:0.5em 0;">${line.trim()}</div>`);
      li++; continue;
    }
    if (/^\s*(Input File|Report File|Output File|Analysis Date|Analysis Time|Elapsed Time):/.test(line)) {
      const colonIdx = line.indexOf(':');
      const label = line.substring(0, colonIdx).trim();
      const val = line.substring(colonIdx + 1).trim();
      htmlLines.push(`<div style="margin:0.15em 0;"><strong>${label}:</strong> ${val}</div>`);
      li++; continue;
    }
    if (/Continuity Error/.test(line)) {
      const val = parseFloat(line.split(/\s+/).pop() || '0');
      const color = Math.abs(val) > 5 ? 'hsl(0,84%,45%)' : Math.abs(val) > 1 ? 'hsl(30,90%,45%)' : 'hsl(142,60%,35%)';
      htmlLines.push(`<div style="color:${color};font-weight:600;font-family:monospace;font-size:0.9em;">${line}</div>`);
      li++; continue;
    }
    if (/Flooding was detected/.test(line)) {
      htmlLines.push(`<div style="color:hsl(30,90%,45%);font-weight:600;padding:0.3em 0;">${line}</div>`);
      li++; continue;
    }
    if (/No nodes were flooded|No conduits were surcharged/.test(line)) {
      htmlLines.push(`<div style="color:hsl(142,60%,35%);font-weight:500;">${line}</div>`);
      li++; continue;
    }
    if (/^\s*\.\.\.\s+\.+\s+/.test(line) || /\s+\.{3,}\s+/.test(line)) {
      const match = line.match(/^\s*(.+?)\s+\.{2,}\s+(.+)$/);
      if (match) {
        const label = match[1].trim();
        const value = match[2].trim();
        let valueHtml = value;
        if (/Continuity Error/.test(label)) {
          const num = parseFloat(value);
          if (!isNaN(num)) {
            const color = Math.abs(num) > 5 ? 'hsl(0,84%,45%)' : Math.abs(num) > 1 ? 'hsl(30,90%,45%)' : 'hsl(142,60%,35%)';
            valueHtml = `<span style="color:${color};font-weight:600;">${value}</span>`;
          }
        }
        htmlLines.push(`<div style="display:flex;gap:0.5em;justify-content:space-between;font-family:monospace;font-size:0.85em;padding:0.1em 0;max-width:500px;"><span>${label}</span><span style="flex-shrink:0;">${valueHtml}</span></div>`);
        li++; continue;
      }
    }
    if (/&lt;&lt;&lt;/.test(line)) {
      const name = line.replace(/&lt;&lt;&lt;|&gt;&gt;&gt;/g, '').trim();
      htmlLines.push(`<div style="font-weight:600;color:hsl(var(--primary));margin:0.8em 0 0.3em;font-size:0.95em;">${name}</div>`);
      li++; continue;
    }
    if (/^\s*\[[\w]+\]/.test(line)) {
      htmlLines.push(`<h3 style="color:hsl(var(--primary));margin:1em 0 0.3em;font-size:0.95em;font-weight:700;font-family:monospace;">${line.trim()}</h3>`);
      li++; continue;
    }
    if (/^\s*;;/.test(line)) {
      htmlLines.push(`<div style="font-family:monospace;font-size:0.8em;color:hsl(var(--muted-foreground));white-space:pre;">${line}</div>`);
      li++; continue;
    }
    if (line.trim() === '') { htmlLines.push('<div style="height:0.4em;"></div>'); li++; continue; }
    htmlLines.push(`<div style="font-family:monospace;font-size:0.85em;white-space:pre;">${line}</div>`);
    li++;
  }

  return `<div style="padding:1em;line-height:1.6;">${htmlLines.join('\n')}</div>`;
}

export default function ResultsDisplay({ results, elapsedTime }: ResultsDisplayProps) {
  const [, setLocation] = useLocation();
  const [expandedErrors, setExpandedErrors] = useState<Set<string>>(new Set());
  const [expandedReports, setExpandedReports] = useState<Set<string>>(new Set());
  
  const successCount = results.filter(r => r.status === 'success').length;
  const failedCount = results.filter(r => r.status === 'failed').length;

  const continuityWarnings = results.filter(r => {
    const m = r.parsedMetrics;
    if (!m) return false;
    return (m.runoffContinuityError !== undefined && Math.abs(m.runoffContinuityError) > 1) ||
           (m.routingContinuityError !== undefined && Math.abs(m.routingContinuityError) > 1);
  });

  const floodedFiles = results.filter(r => r.parsedMetrics?.nodesFlooded && r.parsedMetrics.nodesFlooded > 0);

  const toggleError = (id: string) => {
    const newExpanded = new Set(expandedErrors);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedErrors(newExpanded);
  };

  const toggleReport = (id: string) => {
    const newExpanded = new Set(expandedReports);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedReports(newExpanded);
  };

  const downloadReportAsText = (result: ProcessResult) => {
    if (!result.reportContent) return;
    const blob = new Blob([result.reportContent], { type: 'text/plain;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = result.fileName.replace('.inp', '.rpt');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const exportToCSV = () => {
    const headers = [
      'File Name', 'Status', 'Peak Flow (CFS)', 'Total Volume (MG)',
      'Runoff CE (%)', 'Routing CE (%)', 'Nodes Flooded', 'Flooding Summary',
      'Flow Routing', 'Processing Time (s)', 'Error'
    ];
    const rows = results.map(r => [
      r.fileName,
      r.status,
      r.results?.peakFlow?.toFixed(2) || 'N/A',
      r.results?.totalVolume?.toFixed(2) || 'N/A',
      r.parsedMetrics?.runoffContinuityError?.toFixed(3) || 'N/A',
      r.parsedMetrics?.routingContinuityError?.toFixed(3) || 'N/A',
      r.parsedMetrics?.nodesFlooded?.toString() || 'N/A',
      r.parsedMetrics?.floodingSummary || 'N/A',
      r.parsedMetrics?.flowRoutingMethod || 'N/A',
      r.processingTime?.toFixed(1) || 'N/A',
      r.error || ''
    ]);
    
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(','))
    ].join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `batch-swmm-results-${new Date().toISOString().slice(0,10)}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card data-testid="card-summary-total">
          <CardContent className="p-4">
            <div className="text-center">
              <p className="text-xs text-muted-foreground">Total Processed</p>
              <p className="text-2xl font-bold mt-1" data-testid="text-total-processed">{results.length}</p>
            </div>
          </CardContent>
        </Card>
        
        <Card data-testid="card-summary-success">
          <CardContent className="p-4">
            <div className="text-center">
              <p className="text-xs text-muted-foreground">Successful</p>
              <p className="text-2xl font-bold mt-1 text-green-600" data-testid="text-total-success">{successCount}</p>
            </div>
          </CardContent>
        </Card>
        
        <Card data-testid="card-summary-failed">
          <CardContent className="p-4">
            <div className="text-center">
              <p className="text-xs text-muted-foreground">Failed</p>
              <p className="text-2xl font-bold mt-1 text-destructive" data-testid="text-total-failed">{failedCount}</p>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-summary-warnings">
          <CardContent className="p-4">
            <div className="text-center">
              <p className="text-xs text-muted-foreground">Warnings</p>
              <p className={`text-2xl font-bold mt-1 ${continuityWarnings.length > 0 ? 'text-yellow-600' : 'text-muted-foreground'}`} data-testid="text-total-warnings">
                {continuityWarnings.length}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-4 flex-wrap">
        {elapsedTime && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="text-total-time">
            <Clock className="h-4 w-4" />
            Total time: {elapsedTime}
          </div>
        )}
        {floodedFiles.length > 0 && (
          <div className="flex items-center gap-2 text-sm text-yellow-600" data-testid="text-flooding-alert">
            <Droplets className="h-4 w-4" />
            {floodedFiles.length} file{floodedFiles.length !== 1 ? 's' : ''} with flooding detected
          </div>
        )}
        {continuityWarnings.length > 0 && (
          <div className="flex items-center gap-2 text-sm text-yellow-600" data-testid="text-continuity-alert">
            <AlertTriangle className="h-4 w-4" />
            {continuityWarnings.length} file{continuityWarnings.length !== 1 ? 's' : ''} with continuity error &gt; 1%
          </div>
        )}
      </div>

      <Card data-testid="card-summary-table">
        <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
          <CardTitle className="text-lg" data-testid="text-summary-title">Results Summary</CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            <Button 
              variant="outline" 
              size="sm" 
              onClick={exportToCSV}
              data-testid="button-export-csv"
            >
              <Download className="h-4 w-4 mr-2" />
              Export CSV
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  data-testid="button-generate-report"
                >
                  <FileDown className="h-4 w-4 mr-2" />
                  Generate Report
                  <ChevronDown className="h-3 w-3 ml-1" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => generateAndDownloadReport(results, "html")}
                  data-testid="menu-report-html"
                >
                  <Globe className="h-4 w-4 mr-2" />
                  HTML Report
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => generateAndDownloadReport(results, "markdown")}
                  data-testid="menu-report-markdown"
                >
                  <FileText className="h-4 w-4 mr-2" />
                  Markdown Report
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => generateAndDownloadReport(results, "csv")}
                  data-testid="menu-report-csv"
                >
                  <Download className="h-4 w-4 mr-2" />
                  CSV Report
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="default"
              size="sm"
              onClick={() => {
                setDashboardResults(results, elapsedTime);
                setLocation('/dashboard');
              }}
              data-testid="button-open-dashboard"
            >
              <LayoutDashboard className="h-4 w-4 mr-2" />
              Open in Results Dashboard
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="table-summary">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 px-2 font-medium">File Name</th>
                  <th className="text-left py-2 px-2 font-medium">Status</th>
                  <th className="text-right py-2 px-2 font-medium">Peak Flow</th>
                  <th className="text-right py-2 px-2 font-medium">Volume</th>
                  <th className="text-right py-2 px-2 font-medium">Runoff CE</th>
                  <th className="text-right py-2 px-2 font-medium">Routing CE</th>
                  <th className="text-center py-2 px-2 font-medium">Flooding</th>
                  <th className="text-right py-2 px-2 font-medium">Time</th>
                </tr>
              </thead>
              <tbody>
                {results.map((result) => {
                  const runoffCE = getContinuityErrorBadge(result.parsedMetrics?.runoffContinuityError);
                  const routingCE = getContinuityErrorBadge(result.parsedMetrics?.routingContinuityError);

                  return (
                    <tr key={result.id} className="border-b last:border-0" data-testid={`row-summary-${result.id}`}>
                      <td className="py-2 px-2 font-mono text-xs">{result.fileName}</td>
                      <td className="py-2 px-2">
                        {result.status === 'success' ? (
                          <span className="text-green-600 flex items-center gap-1">
                            <CheckCircle className="h-3 w-3" /> OK
                          </span>
                        ) : (
                          <span className="text-destructive flex items-center gap-1">
                            <XCircle className="h-3 w-3" /> Fail
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-2 text-right font-mono text-xs">
                        {result.results?.peakFlow != null ? `${result.results.peakFlow.toFixed(2)} CFS` : 'N/A'}
                      </td>
                      <td className="py-2 px-2 text-right font-mono text-xs">
                        {result.results?.totalVolume != null ? `${result.results.totalVolume.toFixed(2)} MG` : 'N/A'}
                      </td>
                      <td className="py-2 px-2 text-right">
                        <span className={`font-mono text-xs ${getContinuityErrorColor(result.parsedMetrics?.runoffContinuityError)}`}>
                          {runoffCE.label}
                        </span>
                      </td>
                      <td className="py-2 px-2 text-right">
                        <span className={`font-mono text-xs ${getContinuityErrorColor(result.parsedMetrics?.routingContinuityError)}`}>
                          {routingCE.label}
                        </span>
                      </td>
                      <td className="py-2 px-2 text-center">
                        {result.parsedMetrics?.nodesFlooded !== undefined ? (
                          result.parsedMetrics.nodesFlooded > 0 ? (
                            <Badge variant="secondary" className="text-yellow-700">
                              <Droplets className="h-3 w-3 mr-1" />
                              {result.parsedMetrics.nodesFlooded}
                            </Badge>
                          ) : (
                            <span className="text-xs text-green-600">None</span>
                          )
                        ) : (
                          <span className="text-xs text-muted-foreground">N/A</span>
                        )}
                      </td>
                      <td className="py-2 px-2 text-right font-mono text-xs">
                        {result.processingTime != null ? `${result.processingTime.toFixed(1)}s` : 'N/A'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card data-testid="card-results-list">
        <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
          <CardTitle className="text-lg" data-testid="text-results-title">Detailed Results</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
              {results.map((result) => (
                <div
                  key={result.id}
                  className="rounded-md border p-4"
                  data-testid={`card-result-${result.id}`}
                >
                  <div className="flex items-start gap-3">
                    {result.status === 'success' ? (
                      <CheckCircle className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" data-testid={`icon-success-${result.id}`} />
                    ) : (
                      <XCircle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" data-testid={`icon-failed-${result.id}`} />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium" data-testid={`text-result-filename-${result.id}`}>
                          {result.fileName}
                        </p>
                        <Badge
                          variant={result.status === 'success' ? 'default' : 'destructive'}
                          data-testid={`badge-status-${result.id}`}
                        >
                          {result.status}
                        </Badge>
                        {result.parsedMetrics?.flowRoutingMethod && (
                          <Badge variant="outline" data-testid={`badge-routing-${result.id}`}>
                            {result.parsedMetrics.flowRoutingMethod}
                          </Badge>
                        )}
                        {result.parsedMetrics?.runoffContinuityError !== undefined && Math.abs(result.parsedMetrics.runoffContinuityError) > 1 && (
                          <Badge variant="secondary" className="text-yellow-700" data-testid={`badge-ce-warning-${result.id}`}>
                            <AlertTriangle className="h-3 w-3 mr-1" />
                            CE: {result.parsedMetrics.runoffContinuityError.toFixed(3)}%
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground font-mono mt-1" data-testid={`text-result-filepath-${result.id}`}>
                        {result.filePath}
                      </p>

                      {result.parsedMetrics && result.status === 'success' && (
                        <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground flex-wrap" data-testid={`metrics-summary-${result.id}`}>
                          {result.parsedMetrics.totalPrecipitation !== undefined && (
                            <span>Precip: {result.parsedMetrics.totalPrecipitation.toFixed(3)} ac-ft</span>
                          )}
                          {result.parsedMetrics.surfaceRunoff !== undefined && (
                            <span>Runoff: {result.parsedMetrics.surfaceRunoff.toFixed(3)} ac-ft</span>
                          )}
                          {result.parsedMetrics.floodingSummary && (
                            <span className={result.parsedMetrics.nodesFlooded && result.parsedMetrics.nodesFlooded > 0 ? 'text-yellow-600' : 'text-green-600'}>
                              {result.parsedMetrics.floodingSummary}
                            </span>
                          )}
                        </div>
                      )}

                      {result.error && (
                        <div className="mt-2">
                          <button
                            onClick={() => toggleError(result.id)}
                            className="flex items-center gap-1 text-xs text-destructive hover-elevate rounded px-2 py-1"
                            data-testid={`button-toggle-error-${result.id}`}
                          >
                            {expandedErrors.has(result.id) ? (
                              <ChevronDown className="h-3 w-3" />
                            ) : (
                              <ChevronRight className="h-3 w-3" />
                            )}
                            Error Details
                          </button>
                          {expandedErrors.has(result.id) && (
                            <pre className="mt-2 text-xs bg-muted p-3 rounded font-mono overflow-x-auto" data-testid={`text-error-details-${result.id}`}>
                              {result.error}
                            </pre>
                          )}
                        </div>
                      )}
                      {(result.reportContent || result.inpContent) && (
                        <div className="mt-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <button
                              onClick={() => toggleReport(result.id)}
                              className="flex items-center gap-1 text-xs text-primary hover-elevate rounded px-2 py-1"
                              data-testid={`button-toggle-report-${result.id}`}
                            >
                              {expandedReports.has(result.id) ? (
                                <ChevronDown className="h-3 w-3" />
                              ) : (
                                <ChevronRight className="h-3 w-3" />
                              )}
                              <FileText className="h-3 w-3" />
                              View Files
                            </button>
                            {result.reportContent && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => downloadReportAsText(result)}
                                data-testid={`button-download-report-${result.id}`}
                              >
                                <Download className="h-3 w-3 mr-1" />
                                Download .rpt
                              </Button>
                            )}
                          </div>
                          {expandedReports.has(result.id) && (
                            <div className="mt-2">
                              <Tabs defaultValue={result.inpContent ? "inp" : "text"} data-testid={`tabs-report-${result.id}`}>
                                <TabsList>
                                  {result.inpContent && (
                                    <TabsTrigger value="inp" data-testid={`tab-report-inp-${result.id}`}>
                                      <FileText className="h-3 w-3 mr-1" />
                                      INP
                                    </TabsTrigger>
                                  )}
                                  {result.reportContent && (
                                    <TabsTrigger value="text" data-testid={`tab-report-text-${result.id}`}>
                                      <FileText className="h-3 w-3 mr-1" />
                                      RPT Text
                                    </TabsTrigger>
                                  )}
                                  {result.reportContent && (
                                    <TabsTrigger value="graphs" data-testid={`tab-report-graphs-${result.id}`}>
                                      <BarChart3 className="h-3 w-3 mr-1" />
                                      RPT Graphs
                                    </TabsTrigger>
                                  )}
                                  {result.reportContent && (
                                    <TabsTrigger value="html" data-testid={`tab-report-html-${result.id}`}>
                                      <Globe className="h-3 w-3 mr-1" />
                                      RPT HTML
                                    </TabsTrigger>
                                  )}
                                </TabsList>
                                {result.inpContent && (
                                  <TabsContent value="inp">
                                    <ScrollArea className="h-[800px] rounded border">
                                      <LargeTextViewer content={result.inpContent!} testId={`text-inp-content-${result.id}`} />
                                    </ScrollArea>
                                  </TabsContent>
                                )}
                                {result.reportContent && (
                                  <TabsContent value="text">
                                    <ScrollArea className="h-[800px] rounded border">
                                      <LargeTextViewer content={result.reportContent!} testId={`text-report-content-${result.id}`} />
                                    </ScrollArea>
                                  </TabsContent>
                                )}
                                {result.reportContent && (
                                  <TabsContent value="graphs">
                                    <div className="rounded border p-4 bg-background" data-testid={`graphs-report-content-${result.id}`}>
                                      <InteractiveCharts reportContent={result.reportContent} />
                                    </div>
                                  </TabsContent>
                                )}
                                {result.reportContent && (
                                  <TabsContent value="html">
                                    <ScrollArea className="h-[800px] rounded border">
                                      <div
                                        className="text-sm p-4 bg-background"
                                        dangerouslySetInnerHTML={{ __html: reportToHtml(result.reportContent) }}
                                        data-testid={`html-report-content-${result.id}`}
                                      />
                                    </ScrollArea>
                                  </TabsContent>
                                )}
                              </Tabs>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
        </CardContent>
      </Card>
    </div>
  );
}
