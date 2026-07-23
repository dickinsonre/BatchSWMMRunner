import type { ParsedMetrics } from "@shared/schema";

export const MAX_REPORT_ISSUES = 100;

export function extractReportIssues(reportContent: string): { warnings: string[]; errors: string[] } {
  const warnings: string[] = [];
  const errors: string[] = [];
  for (const rawLine of reportContent.split('\n')) {
    const line = rawLine.trim();
    if (/^WARNING\b/i.test(line)) {
      if (warnings.length < MAX_REPORT_ISSUES) warnings.push(line);
    } else if (/^ERROR\b/i.test(line)) {
      if (errors.length < MAX_REPORT_ISSUES) errors.push(line);
    }
  }
  return { warnings, errors };
}

export function extractEngineVersion(reportContent: string): string | undefined {
  const m = reportContent.match(/EPA STORM WATER MANAGEMENT MODEL - VERSION\s+([\d.]+)(?:\s*\(Build\s+([\d.]+)\))?/i);
  if (m) return m[2] || m[1];
  return undefined;
}

export function validateSwmmReport(reportContent: string | undefined): { valid: boolean; reason?: string } {
  if (!reportContent || reportContent.trim().length === 0) {
    return { valid: false, reason: 'Report file is empty — the engine did not produce output' };
  }
  if (!/EPA STORM WATER MANAGEMENT MODEL/i.test(reportContent)) {
    return { valid: false, reason: 'Report file is missing the EPA SWMM header — output is not a valid SWMM report' };
  }
  const { errors } = extractReportIssues(reportContent);
  if (errors.length > 0) {
    return { valid: false, reason: `SWMM reported error(s): ${errors.slice(0, 5).join('; ')}` };
  }
  return { valid: true };
}

export function parseReportMetrics(reportContent: string): ParsedMetrics {
  const metrics: ParsedMetrics = {};

  const runoffCE = reportContent.match(/Runoff Quantity Continuity[\s\S]*?Continuity Error \(%\)\s*\.+\s*([-\d.]+)/i);
  if (runoffCE) {
    metrics.runoffContinuityError = parseFloat(runoffCE[1]);
  }

  const routingCE = reportContent.match(/Flow Routing Continuity[\s\S]*?Continuity Error \(%\)\s*\.+\s*([-\d.]+)/i);
  if (routingCE) {
    metrics.routingContinuityError = parseFloat(routingCE[1]);
  }

  const precip = reportContent.match(/Total Precipitation\s*\.+\s*([\d.]+)/i);
  if (precip) {
    metrics.totalPrecipitation = parseFloat(precip[1]);
  }

  const runoff = reportContent.match(/Surface Runoff\s*\.+\s*([\d.]+)/i);
  if (runoff) {
    metrics.surfaceRunoff = parseFloat(runoff[1]);
  }

  const floodingMatch = reportContent.match(/Flooding was detected at (\d+) node/i);
  if (floodingMatch) {
    metrics.nodesFlooded = parseInt(floodingMatch[1], 10);
    metrics.floodingSummary = `${floodingMatch[1]} node(s) flooded`;
  } else if (/No nodes were flooded/i.test(reportContent)) {
    metrics.nodesFlooded = 0;
    metrics.floodingSummary = 'No flooding';
  }

  const routingMethod = reportContent.match(/Flow Routing Method\s*\.+\s*(\S+)/i);
  if (routingMethod) {
    metrics.flowRoutingMethod = routingMethod[1];
  }

  const infiltration = reportContent.match(/Infiltration Method\s*\.+\s*(\S+)/i);
  if (infiltration) {
    metrics.infiltrationMethod = infiltration[1];
  }

  const wetInflow = reportContent.match(/Wet Weather Inflow\s*\.+\s*([\d.]+)/i);
  if (wetInflow) {
    metrics.totalInflow = parseFloat(wetInflow[1]);
  }

  const extOutflow = reportContent.match(/External Outflow\s*\.+\s*([\d.]+)/i);
  if (extOutflow) {
    metrics.totalOutflow = parseFloat(extOutflow[1]);
  }

  const floodLoss = reportContent.match(/Flooding Loss\s*\.+\s*([\d.]+)/i);
  if (floodLoss) {
    metrics.floodingLoss = parseFloat(floodLoss[1]);
  }

  const issues = extractReportIssues(reportContent);
  if (issues.warnings.length > 0) metrics.reportWarnings = issues.warnings;
  if (issues.errors.length > 0) metrics.reportErrors = issues.errors;

  return metrics;
}
