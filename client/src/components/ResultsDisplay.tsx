import { CheckCircle, XCircle, ChevronDown, ChevronRight, Download, Clock, FileText, Globe, BarChart3 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useState } from "react";

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
}

interface ResultsDisplayProps {
  results: ProcessResult[];
  elapsedTime?: string;
}

interface TimeSeriesEntry {
  time: string;
  values: number[];
}

interface ParsedTimeSeries {
  title: string;
  element: string;
  columns: string[];
  units: string[];
  data: TimeSeriesEntry[];
}

function parseTimeSeries(rawContent: string): ParsedTimeSeries[] {
  const series: ParsedTimeSeries[] = [];
  const lines = rawContent.split('\n');
  let i = 0;

  while (i < lines.length) {
    if (/^\s*\*{3,}\s*$/.test(lines[i])) {
      i++;
      if (i < lines.length) {
        const titleLine = lines[i].trim();
        if (/Time Series$/i.test(titleLine)) {
          const sectionTitle = titleLine;
          i++;
          while (i < lines.length && /^\s*\*{3,}\s*$/.test(lines[i])) i++;

          while (i < lines.length) {
            if (/^\s*\*{3,}\s*$/.test(lines[i])) {
              const peekTitle = i + 1 < lines.length ? lines[i + 1].trim() : '';
              if (!/Time Series$/i.test(peekTitle)) break;
            }

            const elemMatch = lines[i].match(/<<<\s*(.*?)\s*>>>/);
            if (elemMatch) {
              const elementName = elemMatch[1];
              i++;
              while (i < lines.length && lines[i].trim() === '') i++;
              const colLine = lines[i] || '';
              const columns = colLine.trim().split(/\s{2,}/).filter(c => c && c !== 'Date' && c !== 'Time');
              i++;
              const unitLine = lines[i] || '';
              const units = unitLine.trim().split(/\s{2,}/).filter(u => u && u !== 'Day' && u !== 'Hour:Min');
              i++;
              while (i < lines.length && /^\s*-{3,}/.test(lines[i])) i++;

              const data: TimeSeriesEntry[] = [];
              while (i < lines.length) {
                const dataLine = lines[i].trim();
                if (!dataLine || /^\s*\*{3,}/.test(lines[i]) || /<<</.test(lines[i])) break;
                const parts = dataLine.split(/\s+/);
                if (parts.length >= 4 && /^\d{2}\/\d{2}\/\d{4}$/.test(parts[0])) {
                  const time = parts[1];
                  const values = parts.slice(2).map(v => parseFloat(v)).filter(v => !isNaN(v));
                  if (values.length > 0) {
                    data.push({ time, values });
                  }
                }
                i++;
              }

              if (data.length > 0) {
                series.push({
                  title: sectionTitle,
                  element: elementName,
                  columns,
                  units,
                  data,
                });
              }
              continue;
            }
            i++;
          }
          continue;
        }
      }
    }
    i++;
  }
  return series;
}

function generateSvgChart(ts: ParsedTimeSeries, colIndex: number, color: string, width: number, height: number): string {
  const values = ts.data.map(d => d.values[colIndex] ?? 0);
  const maxVal = Math.max(...values, 0.001);
  const padTop = 30;
  const padBottom = 40;
  const padLeft = 55;
  const padRight = 15;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;
  const colName = ts.columns[colIndex] || `Col ${colIndex}`;
  const unitName = ts.units[colIndex] || '';

  const points = values.map((v, i) => {
    const x = padLeft + (i / Math.max(values.length - 1, 1)) * plotW;
    const y = padTop + plotH - (v / maxVal) * plotH;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const areaPoints = [
    `${padLeft},${padTop + plotH}`,
    ...points,
    `${(padLeft + plotW).toFixed(1)},${padTop + plotH}`,
  ].join(' ');

  const gridLines = [];
  for (let g = 0; g <= 4; g++) {
    const gy = padTop + (g / 4) * plotH;
    const gVal = (maxVal * (1 - g / 4)).toFixed(1);
    gridLines.push(`<line x1="${padLeft}" y1="${gy}" x2="${padLeft + plotW}" y2="${gy}" stroke="hsl(0,0%,80%)" stroke-width="0.5" stroke-dasharray="3,3"/>`);
    gridLines.push(`<text x="${padLeft - 5}" y="${gy + 4}" text-anchor="end" fill="hsl(0,0%,50%)" font-size="9">${gVal}</text>`);
  }

  const labelInterval = Math.max(Math.floor(values.length / 6), 1);
  const timeLabels: string[] = [];
  for (let li = 0; li < ts.data.length; li += labelInterval) {
    const x = padLeft + (li / Math.max(values.length - 1, 1)) * plotW;
    const escapedTime = ts.data[li].time.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    timeLabels.push(`<text x="${x}" y="${padTop + plotH + 18}" text-anchor="middle" fill="hsl(0,0%,50%)" font-size="9">${escapedTime}</text>`);
  }

  const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<svg width="${width}" height="${height}" style="background:transparent;border:1px solid hsl(0,0%,85%);border-radius:6px;margin:4px;">
    <text x="${width / 2}" y="16" text-anchor="middle" fill="hsl(210,40%,40%)" font-size="11" font-weight="600">${escHtml(ts.element)} - ${escHtml(colName)} (${escHtml(unitName)})</text>
    ${gridLines.join('\n')}
    <line x1="${padLeft}" y1="${padTop}" x2="${padLeft}" y2="${padTop + plotH}" stroke="hsl(0,0%,70%)" stroke-width="1"/>
    <line x1="${padLeft}" y1="${padTop + plotH}" x2="${padLeft + plotW}" y2="${padTop + plotH}" stroke="hsl(0,0%,70%)" stroke-width="1"/>
    <polygon points="${areaPoints}" fill="${color}" opacity="0.15"/>
    <polyline points="${points.join(' ')}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round"/>
    ${timeLabels.join('\n')}
    <text x="${padLeft + plotW / 2}" y="${padTop + plotH + 34}" text-anchor="middle" fill="hsl(0,0%,40%)" font-size="9">Time (HH:MM)</text>
  </svg>`;
}

function generateTableHtml(ts: ParsedTimeSeries): string {
  const escH = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const maxCols = Math.min(ts.columns.length, ts.data[0]?.values.length ?? 0);
  const step = Math.max(Math.floor(ts.data.length / 20), 1);

  let html = '<table style="border-collapse:collapse;font-family:monospace;font-size:0.8em;margin:8px 0;width:auto;">';
  html += '<thead><tr style="border-bottom:2px solid hsl(210,20%,75%);">';
  html += '<th style="padding:3px 10px;text-align:left;color:hsl(210,40%,35%);">Time</th>';
  for (let c = 0; c < maxCols; c++) {
    const unit = ts.units[c] ? ` (${escH(ts.units[c])})` : '';
    html += `<th style="padding:3px 10px;text-align:right;color:hsl(210,40%,35%);">${escH(ts.columns[c] || '')}${unit}</th>`;
  }
  html += '</tr></thead><tbody>';

  for (let r = 0; r < ts.data.length; r += step) {
    const d = ts.data[r];
    const bg = (r / step) % 2 === 0 ? '' : ' style="background:hsl(210,20%,96%);"';
    html += `<tr${bg}>`;
    html += `<td style="padding:2px 10px;white-space:nowrap;">${escH(d.time)}</td>`;
    for (let c = 0; c < maxCols; c++) {
      html += `<td style="padding:2px 10px;text-align:right;">${(d.values[c] ?? 0).toFixed(2)}</td>`;
    }
    html += '</tr>';
  }
  html += '</tbody></table>';
  return html;
}

function generateChartsAndTablesHtml(allSeries: ParsedTimeSeries[]): string {
  if (allSeries.length === 0) return '';

  const chartColors = [
    'hsl(210,85%,50%)',
    'hsl(340,75%,50%)',
    'hsl(142,60%,40%)',
    'hsl(35,90%,50%)',
    'hsl(270,60%,55%)',
    'hsl(180,55%,40%)',
  ];

  const sections: { [key: string]: string[] } = {};
  for (const ts of allSeries) {
    const chartW = 420;
    const chartH = 200;
    const charts: string[] = [];

    const maxCols = Math.min(ts.columns.length, ts.data[0]?.values.length ?? 0);
    for (let c = 0; c < maxCols; c++) {
      const allZero = ts.data.every(d => (d.values[c] ?? 0) === 0);
      if (allZero) continue;
      charts.push(generateSvgChart(ts, c, chartColors[c % chartColors.length], chartW, chartH));
    }

    if (charts.length > 0) {
      const escH = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const tableHtml = generateTableHtml(ts);
      if (!sections[ts.title]) sections[ts.title] = [];
      sections[ts.title].push(`
        <div style="margin-bottom:16px;">
          <div style="font-weight:600;font-size:0.95em;color:hsl(210,40%,35%);margin-bottom:6px;">${escH(ts.element)}</div>
          <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px;">${charts.join('')}</div>
          <details style="margin-top:4px;">
            <summary style="cursor:pointer;font-size:0.85em;color:hsl(210,60%,45%);font-weight:500;">Show Data Table</summary>
            ${tableHtml}
          </details>
        </div>
      `);
    }
  }

  let html = '<div style="margin-top:1.5em;border-top:2px solid hsl(210,20%,85%);padding-top:1em;">';
  html += '<h2 style="color:hsl(210,95%,45%);font-size:1.15em;font-weight:700;margin-bottom:0.8em;">Time Series Results</h2>';
  for (const [sectionTitle, chartGroups] of Object.entries(sections)) {
    html += `<h3 style="color:hsl(210,60%,40%);font-size:1em;font-weight:600;margin:1em 0 0.5em;border-bottom:1px solid hsl(210,20%,85%);padding-bottom:0.2em;">${sectionTitle}</h3>`;
    html += chartGroups.join('');
  }
  html += '</div>';
  return html;
}

function generateChartsOnlyHtml(allSeries: ParsedTimeSeries[]): string {
  if (allSeries.length === 0) return '<p style="color:hsl(0,0%,50%);font-style:italic;">No time series data available for graphs.</p>';

  const chartColors = [
    'hsl(210,85%,50%)',
    'hsl(340,75%,50%)',
    'hsl(142,60%,40%)',
    'hsl(35,90%,50%)',
    'hsl(270,60%,55%)',
    'hsl(180,55%,40%)',
  ];

  const sections: { [key: string]: string[] } = {};
  for (const ts of allSeries) {
    const chartW = 480;
    const chartH = 220;
    const charts: string[] = [];

    const maxCols = Math.min(ts.columns.length, ts.data[0]?.values.length ?? 0);
    for (let c = 0; c < maxCols; c++) {
      const allZero = ts.data.every(d => (d.values[c] ?? 0) === 0);
      if (allZero) continue;
      charts.push(generateSvgChart(ts, c, chartColors[c % chartColors.length], chartW, chartH));
    }

    if (charts.length > 0) {
      const escH = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      if (!sections[ts.title]) sections[ts.title] = [];
      sections[ts.title].push(`
        <div style="margin-bottom:20px;">
          <div style="font-weight:600;font-size:0.95em;color:hsl(210,40%,35%);margin-bottom:8px;">${escH(ts.element)}</div>
          <div style="display:flex;flex-wrap:wrap;gap:10px;">${charts.join('')}</div>
        </div>
      `);
    }
  }

  let html = '<div style="padding:8px 0;">';
  html += '<h2 style="color:hsl(210,95%,45%);font-size:1.2em;font-weight:700;margin-bottom:1em;">Time Series Graphs</h2>';
  for (const [sectionTitle, chartGroups] of Object.entries(sections)) {
    html += `<h3 style="color:hsl(210,60%,40%);font-size:1.05em;font-weight:600;margin:1.2em 0 0.6em;border-bottom:1px solid hsl(210,20%,85%);padding-bottom:0.3em;">${sectionTitle}</h3>`;
    html += chartGroups.join('');
  }
  html += '</div>';
  return html;
}

function reportToGraphsHtml(content: string): string {
  const allSeries = parseTimeSeries(content);
  return generateChartsOnlyHtml(allSeries);
}

function reportToHtml(content: string): string {
  const allSeries = parseTimeSeries(content);

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
    tsSkipEnd = lastStart + 2;
    for (let si = tsSkipEnd; si < lines.length; si++) {
      if (/^\s*\*{3,}/.test(lines[si]) && !/Time Series$/i.test(lines[si + 1]?.trim() || '')) {
        break;
      }
      tsSkipEnd = si;
    }
  }

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];

    if (tsSkipStart >= 0 && li >= tsSkipStart && li <= tsSkipEnd) continue;

    if (/^\s*\*{3,}/.test(line)) {
      const title = line.replace(/\*/g, '').trim();
      if (title) {
        htmlLines.push(`<h2 style="color:hsl(210,95%,45%);margin:1.2em 0 0.4em;font-size:1.1em;font-weight:700;border-bottom:1px solid hsl(210,20%,80%);padding-bottom:0.2em;">${title}</h2>`);
      }
      continue;
    }
    if (/^\s*-{5,}/.test(line)) {
      htmlLines.push(`<hr style="border:none;border-top:1px solid hsl(0,0%,80%);margin:0.3em 0;" />`);
      continue;
    }
    if (/EPA STORM WATER MANAGEMENT MODEL/.test(line)) {
      htmlLines.push(`<h1 style="color:hsl(210,95%,35%);font-size:1.2em;font-weight:700;margin-bottom:0.2em;">${line.trim()}</h1>`);
      continue;
    }
    if (/EPA SWMM/.test(line)) {
      htmlLines.push(`<div style="font-weight:700;font-size:1.1em;color:hsl(210,95%,40%);margin:0.5em 0;">${line.trim()}</div>`);
      continue;
    }
    if (/^\s*(Input File|Report File|Output File|Analysis Date|Analysis Time|Elapsed Time):/.test(line)) {
      const [label, ...rest] = line.split(':');
      htmlLines.push(`<div><strong>${label.trim()}:</strong> ${rest.join(':').trim()}</div>`);
      continue;
    }
    if (/Continuity Error/.test(line)) {
      const val = parseFloat(line.split(/\s+/).pop() || '0');
      const color = Math.abs(val) > 0.1 ? 'hsl(0,84%,45%)' : 'hsl(142,60%,35%)';
      htmlLines.push(`<div style="color:${color};font-weight:600;">${line}</div>`);
      continue;
    }
    if (/Flooding was detected/.test(line)) {
      htmlLines.push(`<div style="color:hsl(30,90%,45%);font-weight:600;">${line}</div>`);
      continue;
    }
    if (/No nodes were flooded|No conduits were surcharged/.test(line)) {
      htmlLines.push(`<div style="color:hsl(142,60%,35%);font-weight:500;">${line}</div>`);
      continue;
    }
    if (/(JUNCTION|OUTFALL|CONDUIT)\s/.test(line)) {
      htmlLines.push(`<div style="font-family:monospace;font-size:0.85em;">${line}</div>`);
      continue;
    }
    if (/&lt;&lt;&lt;/.test(line)) {
      const name = line.replace(/&lt;&lt;&lt;|&gt;&gt;&gt;/g, '').trim();
      htmlLines.push(`<div style="font-weight:600;color:hsl(210,60%,40%);margin:0.8em 0 0.3em;font-size:0.95em;">${name}</div>`);
      continue;
    }
    if (/^\s*\[[\w]+\]/.test(line)) {
      htmlLines.push(`<h3 style="color:hsl(210,95%,45%);margin:1em 0 0.3em;font-size:0.95em;font-weight:700;font-family:monospace;">${line.trim()}</h3>`);
      continue;
    }
    if (/^\s*;;/.test(line)) {
      htmlLines.push(`<div style="font-family:monospace;font-size:0.8em;color:hsl(0,0%,50%);white-space:pre;">${line}</div>`);
      continue;
    }
    if (line.trim() === '') { htmlLines.push('<div style="height:0.4em;"></div>'); continue; }
    htmlLines.push(`<div style="font-family:monospace;font-size:0.85em;white-space:pre;">${line}</div>`);
  }

  const chartsHtml = generateChartsAndTablesHtml(allSeries);

  return `<div style="padding:1em;line-height:1.6;">${htmlLines.join('\n')}${chartsHtml}</div>`;
}

export default function ResultsDisplay({ results, elapsedTime }: ResultsDisplayProps) {
  const [expandedErrors, setExpandedErrors] = useState<Set<string>>(new Set());
  const [expandedReports, setExpandedReports] = useState<Set<string>>(new Set());
  
  const successCount = results.filter(r => r.status === 'success').length;
  const failedCount = results.filter(r => r.status === 'failed').length;

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
    const headers = ['File Name', 'File Path', 'Status', 'Peak Flow (CFS)', 'Total Volume (MG)', 'Processing Time (s)', 'Error'];
    const rows = results.map(r => [
      r.fileName,
      r.filePath,
      r.status,
      r.results?.peakFlow?.toFixed(2) || 'N/A',
      r.results?.totalVolume?.toFixed(2) || 'N/A',
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
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card data-testid="card-summary-total">
          <CardContent className="p-6">
            <div className="text-center">
              <p className="text-sm text-muted-foreground">Total Processed</p>
              <p className="text-3xl font-bold mt-2" data-testid="text-total-processed">{results.length}</p>
            </div>
          </CardContent>
        </Card>
        
        <Card data-testid="card-summary-success">
          <CardContent className="p-6">
            <div className="text-center">
              <p className="text-sm text-muted-foreground">Successful</p>
              <p className="text-3xl font-bold mt-2 text-green-600" data-testid="text-total-success">{successCount}</p>
            </div>
          </CardContent>
        </Card>
        
        <Card data-testid="card-summary-failed">
          <CardContent className="p-6">
            <div className="text-center">
              <p className="text-sm text-muted-foreground">Failed</p>
              <p className="text-3xl font-bold mt-2 text-destructive" data-testid="text-total-failed">{failedCount}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {elapsedTime && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="text-total-time">
          <Clock className="h-4 w-4" />
          Total processing time: {elapsedTime}
        </div>
      )}

      <Card data-testid="card-summary-table">
        <CardHeader>
          <CardTitle className="text-lg" data-testid="text-summary-title">Summary Table</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="table-summary">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 px-3 font-medium">File Name</th>
                  <th className="text-left py-2 px-3 font-medium">Status</th>
                  <th className="text-right py-2 px-3 font-medium">Peak Flow</th>
                  <th className="text-right py-2 px-3 font-medium">Total Volume</th>
                  <th className="text-right py-2 px-3 font-medium">Time</th>
                </tr>
              </thead>
              <tbody>
                {results.map((result) => (
                  <tr key={result.id} className="border-b last:border-0" data-testid={`row-summary-${result.id}`}>
                    <td className="py-2 px-3 font-mono text-xs">{result.fileName}</td>
                    <td className="py-2 px-3">
                      {result.status === 'success' ? (
                        <span className="text-green-600 flex items-center gap-1">
                          <CheckCircle className="h-3 w-3" /> Success
                        </span>
                      ) : (
                        <span className="text-destructive flex items-center gap-1">
                          <XCircle className="h-3 w-3" /> Failed
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-3 text-right font-mono">
                      {result.results?.peakFlow != null ? `${result.results.peakFlow.toFixed(2)} CFS` : 'N/A'}
                    </td>
                    <td className="py-2 px-3 text-right font-mono">
                      {result.results?.totalVolume != null ? `${result.results.totalVolume.toFixed(2)} MG` : 'N/A'}
                    </td>
                    <td className="py-2 px-3 text-right font-mono">
                      {result.processingTime != null ? `${result.processingTime.toFixed(1)}s` : 'N/A'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card data-testid="card-results-list">
        <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
          <CardTitle className="text-lg" data-testid="text-results-title">Processing Results</CardTitle>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={exportToCSV}
            data-testid="button-export-csv"
          >
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
        </CardHeader>
        <CardContent>
          <ScrollArea className="max-h-96">
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
                      </div>
                      <p className="text-xs text-muted-foreground font-mono mt-1" data-testid={`text-result-filepath-${result.id}`}>
                        {result.filePath}
                      </p>
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
                                      <pre className="text-xs p-4 font-mono whitespace-pre overflow-x-auto bg-muted" data-testid={`text-inp-content-${result.id}`}>
                                        {result.inpContent}
                                      </pre>
                                    </ScrollArea>
                                  </TabsContent>
                                )}
                                {result.reportContent && (
                                  <TabsContent value="text">
                                    <ScrollArea className="h-[800px] rounded border">
                                      <pre className="text-xs p-4 font-mono whitespace-pre overflow-x-auto bg-muted" data-testid={`text-report-content-${result.id}`}>
                                        {result.reportContent}
                                      </pre>
                                    </ScrollArea>
                                  </TabsContent>
                                )}
                                {result.reportContent && (
                                  <TabsContent value="graphs">
                                    <ScrollArea className="h-[800px] rounded border">
                                      <div
                                        className="text-sm p-4 bg-background"
                                        dangerouslySetInnerHTML={{ __html: reportToGraphsHtml(result.reportContent) }}
                                        data-testid={`graphs-report-content-${result.id}`}
                                      />
                                    </ScrollArea>
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
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
