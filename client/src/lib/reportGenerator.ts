import type { ProcessResult } from "@shared/schema";

interface ReportData {
  results: ProcessResult[];
  generationDate: string;
  modelCount: number;
  successCount: number;
  failedCount: number;
  warningCount: number;
  bestRunoffCE: { fileName: string; value: number } | null;
  worstRunoffCE: { fileName: string; value: number } | null;
  avgRunoffCE: number | null;
  bestRoutingCE: { fileName: string; value: number } | null;
  worstRoutingCE: { fileName: string; value: number } | null;
  avgRoutingCE: number | null;
  floodedModels: { fileName: string; nodesFlooded: number; floodingLoss: number | undefined }[];
  recommendations: string[];
}

function analyzeResults(results: ProcessResult[]): ReportData {
  const generationDate = new Date().toLocaleString();
  const successResults = results.filter(r => r.status === "success");
  const failedCount = results.filter(r => r.status === "failed").length;

  const withRunoffCE = successResults.filter(r => r.parsedMetrics?.runoffContinuityError !== undefined);
  const withRoutingCE = successResults.filter(r => r.parsedMetrics?.routingContinuityError !== undefined);

  const warningCount = successResults.filter(r => {
    const m = r.parsedMetrics;
    if (!m) return false;
    return (m.runoffContinuityError !== undefined && Math.abs(m.runoffContinuityError) > 1) ||
           (m.routingContinuityError !== undefined && Math.abs(m.routingContinuityError) > 1);
  }).length;

  let bestRunoffCE: ReportData["bestRunoffCE"] = null;
  let worstRunoffCE: ReportData["worstRunoffCE"] = null;
  let avgRunoffCE: number | null = null;

  if (withRunoffCE.length > 0) {
    const sorted = [...withRunoffCE].sort((a, b) =>
      Math.abs(a.parsedMetrics!.runoffContinuityError!) - Math.abs(b.parsedMetrics!.runoffContinuityError!)
    );
    bestRunoffCE = { fileName: sorted[0].fileName, value: sorted[0].parsedMetrics!.runoffContinuityError! };
    worstRunoffCE = { fileName: sorted[sorted.length - 1].fileName, value: sorted[sorted.length - 1].parsedMetrics!.runoffContinuityError! };
    avgRunoffCE = withRunoffCE.reduce((sum, r) => sum + Math.abs(r.parsedMetrics!.runoffContinuityError!), 0) / withRunoffCE.length;
  }

  let bestRoutingCE: ReportData["bestRoutingCE"] = null;
  let worstRoutingCE: ReportData["worstRoutingCE"] = null;
  let avgRoutingCE: number | null = null;

  if (withRoutingCE.length > 0) {
    const sorted = [...withRoutingCE].sort((a, b) =>
      Math.abs(a.parsedMetrics!.routingContinuityError!) - Math.abs(b.parsedMetrics!.routingContinuityError!)
    );
    bestRoutingCE = { fileName: sorted[0].fileName, value: sorted[0].parsedMetrics!.routingContinuityError! };
    worstRoutingCE = { fileName: sorted[sorted.length - 1].fileName, value: sorted[sorted.length - 1].parsedMetrics!.routingContinuityError! };
    avgRoutingCE = withRoutingCE.reduce((sum, r) => sum + Math.abs(r.parsedMetrics!.routingContinuityError!), 0) / withRoutingCE.length;
  }

  const floodedModels = successResults
    .filter(r => r.parsedMetrics?.nodesFlooded && r.parsedMetrics.nodesFlooded > 0)
    .map(r => ({
      fileName: r.fileName,
      nodesFlooded: r.parsedMetrics!.nodesFlooded!,
      floodingLoss: r.parsedMetrics!.floodingLoss,
    }));

  const recommendations: string[] = [];
  if (worstRunoffCE && Math.abs(worstRunoffCE.value) > 5) {
    recommendations.push(`High runoff continuity error (${worstRunoffCE.value.toFixed(3)}%) in "${worstRunoffCE.fileName}". Consider reducing the runoff time step or checking subcatchment parameters.`);
  }
  if (worstRoutingCE && Math.abs(worstRoutingCE.value) > 5) {
    recommendations.push(`High routing continuity error (${worstRoutingCE.value.toFixed(3)}%) in "${worstRoutingCE.fileName}". Consider reducing the routing time step or using a different flow routing method.`);
  }
  if (warningCount > 0) {
    recommendations.push(`${warningCount} model(s) have continuity errors exceeding 1%. Review time step settings and model parameters.`);
  }
  if (floodedModels.length > 0) {
    const totalFlooded = floodedModels.reduce((sum, m) => sum + m.nodesFlooded, 0);
    recommendations.push(`Flooding detected in ${floodedModels.length} model(s) affecting ${totalFlooded} node(s). Consider upsizing pipes or adding storage.`);
  }
  if (failedCount > 0) {
    recommendations.push(`${failedCount} model(s) failed to run. Check input file formatting and SWMM engine compatibility.`);
  }
  if (recommendations.length === 0) {
    recommendations.push("All models completed successfully with acceptable continuity errors and no flooding. No immediate action required.");
  }

  return {
    results,
    generationDate,
    modelCount: results.length,
    successCount: successResults.length,
    failedCount,
    warningCount,
    bestRunoffCE,
    worstRunoffCE,
    avgRunoffCE,
    bestRoutingCE,
    worstRoutingCE,
    avgRoutingCE,
    floodedModels,
    recommendations,
  };
}

function fmtNum(val: number | undefined | null, decimals = 3): string {
  if (val === undefined || val === null) return "N/A";
  return val.toFixed(decimals);
}

export function generateHTMLReport(results: ProcessResult[]): string {
  const d = analyzeResults(results);

  const ceFlag = (val: number | undefined) => {
    if (val === undefined) return "";
    const abs = Math.abs(val);
    if (abs <= 1) return "background-color:#d1fae5;";
    if (abs <= 5) return "background-color:#fef9c3;";
    return "background-color:#fecaca;";
  };

  const ceRows = d.results
    .filter(r => r.status === "success")
    .map(r => `<tr>
      <td style="padding:6px 10px;border:1px solid #e5e7eb;">${r.fileName}</td>
      <td style="padding:6px 10px;border:1px solid #e5e7eb;text-align:right;${ceFlag(r.parsedMetrics?.runoffContinuityError)}">${fmtNum(r.parsedMetrics?.runoffContinuityError)}%</td>
      <td style="padding:6px 10px;border:1px solid #e5e7eb;text-align:right;${ceFlag(r.parsedMetrics?.routingContinuityError)}">${fmtNum(r.parsedMetrics?.routingContinuityError)}%</td>
    </tr>`).join("\n");

  const floodRows = d.floodedModels.length > 0
    ? d.floodedModels.map(m => `<tr>
        <td style="padding:6px 10px;border:1px solid #e5e7eb;">${m.fileName}</td>
        <td style="padding:6px 10px;border:1px solid #e5e7eb;text-align:right;">${m.nodesFlooded}</td>
        <td style="padding:6px 10px;border:1px solid #e5e7eb;text-align:right;">${m.floodingLoss !== undefined ? fmtNum(m.floodingLoss) : "N/A"}</td>
      </tr>`).join("\n")
    : `<tr><td colspan="3" style="padding:6px 10px;border:1px solid #e5e7eb;text-align:center;color:#16a34a;">No flooding detected in any model.</td></tr>`;

  const hydrologyRows = d.results
    .filter(r => r.status === "success" && r.parsedMetrics)
    .map(r => `<tr>
      <td style="padding:6px 10px;border:1px solid #e5e7eb;">${r.fileName}</td>
      <td style="padding:6px 10px;border:1px solid #e5e7eb;text-align:right;">${fmtNum(r.parsedMetrics?.totalPrecipitation)}</td>
      <td style="padding:6px 10px;border:1px solid #e5e7eb;text-align:right;">${fmtNum(r.parsedMetrics?.surfaceRunoff)}</td>
      <td style="padding:6px 10px;border:1px solid #e5e7eb;text-align:right;">${fmtNum(r.results?.peakFlow, 2)}</td>
      <td style="padding:6px 10px;border:1px solid #e5e7eb;text-align:right;">${fmtNum(r.results?.totalVolume, 2)}</td>
    </tr>`).join("\n");

  const recItems = d.recommendations.map(r => `<li style="margin-bottom:6px;">${r}</li>`).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>BatchSWMM Comparison Report</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 900px; margin: 0 auto; padding: 24px; color: #1f2937; line-height: 1.6; }
  h1 { color: #1e40af; border-bottom: 3px solid #1e40af; padding-bottom: 8px; font-size: 1.5em; }
  h2 { color: #1e40af; border-bottom: 1px solid #dbeafe; padding-bottom: 4px; margin-top: 2em; font-size: 1.2em; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 0.9em; }
  th { background-color: #1e40af; color: white; padding: 8px 10px; text-align: left; border: 1px solid #1e40af; }
  th.right { text-align: right; }
  .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 16px 0; }
  .summary-card { border: 1px solid #e5e7eb; border-radius: 6px; padding: 16px; text-align: center; }
  .summary-card .label { font-size: 0.8em; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em; }
  .summary-card .value { font-size: 1.8em; font-weight: 700; margin-top: 4px; }
  .green { color: #16a34a; }
  .red { color: #dc2626; }
  .yellow { color: #ca8a04; }
  .meta { color: #6b7280; font-size: 0.85em; }
  .rec-list { background: #f0f9ff; border-left: 4px solid #1e40af; padding: 12px 16px; border-radius: 0 6px 6px 0; }
  .rec-list li { color: #1e3a5f; }
  @media print { body { max-width: 100%; } .summary-grid { grid-template-columns: repeat(4, 1fr); } }
</style>
</head>
<body>
<h1>BatchSWMM Comparison Report</h1>
<p class="meta">Generated: ${d.generationDate} | SWMM Engine: EPA SWMM 5.x | Models: ${d.modelCount}</p>

<h2>Summary</h2>
<div class="summary-grid">
  <div class="summary-card"><div class="label">Models Run</div><div class="value">${d.modelCount}</div></div>
  <div class="summary-card"><div class="label">Successful</div><div class="value green">${d.successCount}</div></div>
  <div class="summary-card"><div class="label">Warnings (CE &gt; 1%)</div><div class="value yellow">${d.warningCount}</div></div>
  <div class="summary-card"><div class="label">Failed</div><div class="value red">${d.failedCount}</div></div>
</div>

<h2>Continuity Errors</h2>
<p>
  <strong>Best Runoff CE:</strong> ${d.bestRunoffCE ? `${d.bestRunoffCE.fileName} (${fmtNum(d.bestRunoffCE.value)}%)` : "N/A"} |
  <strong>Worst Runoff CE:</strong> ${d.worstRunoffCE ? `${d.worstRunoffCE.fileName} (${fmtNum(d.worstRunoffCE.value)}%)` : "N/A"} |
  <strong>Average |Runoff CE|:</strong> ${d.avgRunoffCE !== null ? fmtNum(d.avgRunoffCE) + "%" : "N/A"}
</p>
<p>
  <strong>Best Routing CE:</strong> ${d.bestRoutingCE ? `${d.bestRoutingCE.fileName} (${fmtNum(d.bestRoutingCE.value)}%)` : "N/A"} |
  <strong>Worst Routing CE:</strong> ${d.worstRoutingCE ? `${d.worstRoutingCE.fileName} (${fmtNum(d.worstRoutingCE.value)}%)` : "N/A"} |
  <strong>Average |Routing CE|:</strong> ${d.avgRoutingCE !== null ? fmtNum(d.avgRoutingCE) + "%" : "N/A"}
</p>
<table>
  <thead><tr><th>File Name</th><th class="right">Runoff CE</th><th class="right">Routing CE</th></tr></thead>
  <tbody>${ceRows}</tbody>
</table>

<h2>Flooding Summary</h2>
<table>
  <thead><tr><th>File Name</th><th class="right">Nodes Flooded</th><th class="right">Flooding Loss</th></tr></thead>
  <tbody>${floodRows}</tbody>
</table>

<h2>Hydrology Comparison</h2>
<table>
  <thead><tr><th>File Name</th><th class="right">Precipitation (ac-ft)</th><th class="right">Surface Runoff (ac-ft)</th><th class="right">Peak Flow (CFS)</th><th class="right">Total Volume (MG)</th></tr></thead>
  <tbody>${hydrologyRows}</tbody>
</table>

<h2>Recommendations</h2>
<ul class="rec-list">
${recItems}
</ul>

<hr style="margin-top:2em;border:none;border-top:1px solid #e5e7eb;">
<p class="meta" style="text-align:center;">Report generated by BatchSWMM</p>
</body>
</html>`;
}

export function generateMarkdownReport(results: ProcessResult[]): string {
  const d = analyzeResults(results);

  const lines: string[] = [];
  lines.push("# BatchSWMM Comparison Report");
  lines.push("");
  lines.push(`**Generated:** ${d.generationDate} | **SWMM Engine:** EPA SWMM 5.x | **Models:** ${d.modelCount}`);
  lines.push("");

  lines.push("## Summary");
  lines.push("");
  lines.push(`| Metric | Count |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Models Run | ${d.modelCount} |`);
  lines.push(`| Successful | ${d.successCount} |`);
  lines.push(`| Warnings (CE > 1%) | ${d.warningCount} |`);
  lines.push(`| Failed | ${d.failedCount} |`);
  lines.push("");

  lines.push("## Continuity Errors");
  lines.push("");
  if (d.bestRunoffCE) lines.push(`- **Best Runoff CE:** ${d.bestRunoffCE.fileName} (${fmtNum(d.bestRunoffCE.value)}%)`);
  if (d.worstRunoffCE) lines.push(`- **Worst Runoff CE:** ${d.worstRunoffCE.fileName} (${fmtNum(d.worstRunoffCE.value)}%)`);
  if (d.avgRunoffCE !== null) lines.push(`- **Average |Runoff CE|:** ${fmtNum(d.avgRunoffCE)}%`);
  if (d.bestRoutingCE) lines.push(`- **Best Routing CE:** ${d.bestRoutingCE.fileName} (${fmtNum(d.bestRoutingCE.value)}%)`);
  if (d.worstRoutingCE) lines.push(`- **Worst Routing CE:** ${d.worstRoutingCE.fileName} (${fmtNum(d.worstRoutingCE.value)}%)`);
  if (d.avgRoutingCE !== null) lines.push(`- **Average |Routing CE|:** ${fmtNum(d.avgRoutingCE)}%`);
  lines.push("");

  lines.push("| File Name | Runoff CE | Routing CE |");
  lines.push("|-----------|-----------|------------|");
  d.results.filter(r => r.status === "success").forEach(r => {
    lines.push(`| ${r.fileName} | ${fmtNum(r.parsedMetrics?.runoffContinuityError)}% | ${fmtNum(r.parsedMetrics?.routingContinuityError)}% |`);
  });
  lines.push("");

  lines.push("## Flooding Summary");
  lines.push("");
  if (d.floodedModels.length > 0) {
    lines.push("| File Name | Nodes Flooded | Flooding Loss |");
    lines.push("|-----------|---------------|---------------|");
    d.floodedModels.forEach(m => {
      lines.push(`| ${m.fileName} | ${m.nodesFlooded} | ${m.floodingLoss !== undefined ? fmtNum(m.floodingLoss) : "N/A"} |`);
    });
  } else {
    lines.push("No flooding detected in any model.");
  }
  lines.push("");

  lines.push("## Hydrology Comparison");
  lines.push("");
  lines.push("| File Name | Precipitation (ac-ft) | Surface Runoff (ac-ft) | Peak Flow (CFS) | Total Volume (MG) |");
  lines.push("|-----------|----------------------|----------------------|-----------------|-------------------|");
  d.results.filter(r => r.status === "success" && r.parsedMetrics).forEach(r => {
    lines.push(`| ${r.fileName} | ${fmtNum(r.parsedMetrics?.totalPrecipitation)} | ${fmtNum(r.parsedMetrics?.surfaceRunoff)} | ${fmtNum(r.results?.peakFlow, 2)} | ${fmtNum(r.results?.totalVolume, 2)} |`);
  });
  lines.push("");

  lines.push("## Recommendations");
  lines.push("");
  d.recommendations.forEach(r => lines.push(`- ${r}`));
  lines.push("");
  lines.push("---");
  lines.push("*Report generated by BatchSWMM*");

  return lines.join("\n");
}

export function generateCSVReport(results: ProcessResult[]): string {
  const headers = [
    "File Name", "Status", "Peak Flow (CFS)", "Total Volume (MG)",
    "Runoff CE (%)", "Routing CE (%)", "Precipitation (ac-ft)", "Surface Runoff (ac-ft)",
    "Nodes Flooded", "Flooding Loss", "Flooding Summary", "Flow Routing Method",
    "Processing Time (s)", "Error"
  ];

  const rows = results.map(r => [
    r.fileName,
    r.status,
    r.results?.peakFlow?.toFixed(2) ?? "",
    r.results?.totalVolume?.toFixed(2) ?? "",
    r.parsedMetrics?.runoffContinuityError?.toFixed(3) ?? "",
    r.parsedMetrics?.routingContinuityError?.toFixed(3) ?? "",
    r.parsedMetrics?.totalPrecipitation?.toFixed(3) ?? "",
    r.parsedMetrics?.surfaceRunoff?.toFixed(3) ?? "",
    r.parsedMetrics?.nodesFlooded?.toString() ?? "",
    r.parsedMetrics?.floodingLoss?.toFixed(3) ?? "",
    r.parsedMetrics?.floodingSummary ?? "",
    r.parsedMetrics?.flowRoutingMethod ?? "",
    r.processingTime?.toFixed(1) ?? "",
    r.error ?? "",
  ]);

  return [
    headers.join(","),
    ...rows.map(row => row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(","))
  ].join("\n");
}

export function downloadReport(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.style.visibility = "hidden";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export type ReportFormat = "html" | "markdown" | "csv";

export function generateAndDownloadReport(results: ProcessResult[], format: ReportFormat) {
  const dateStr = new Date().toISOString().slice(0, 10);
  switch (format) {
    case "html": {
      const content = generateHTMLReport(results);
      downloadReport(content, `batchswmm-report-${dateStr}.html`, "text/html;charset=utf-8");
      break;
    }
    case "markdown": {
      const content = generateMarkdownReport(results);
      downloadReport(content, `batchswmm-report-${dateStr}.md`, "text/markdown;charset=utf-8");
      break;
    }
    case "csv": {
      const content = generateCSVReport(results);
      downloadReport(content, `batchswmm-report-${dateStr}.csv`, "text/csv;charset=utf-8");
      break;
    }
  }
}
