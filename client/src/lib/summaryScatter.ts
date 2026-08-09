// Extracts peak-value maps from SWMM .rpt summary tables for the Rossman-style
// engine-vs-engine scatter plots. Plain .ts (no JSX) so node tests can import.
//
// The summary tables use multi-line headers, so generic header matching fails;
// instead each parser walks to the section, skips the header block, and reads
// whitespace-split data rows at known column positions:
//
//   Link Flow Summary:      Link Type MaxFlow days hr:min MaxVel [MaxFullFlow MaxFullDepth]
//   Node Depth Summary:     Node Type AvgDepth MaxDepth MaxHGL days hr:min [ReportedMaxDepth]
//   Subcatchment Runoff:    Name Precip Runon Evap Infil ImpervRO PervRO TotalRO(depth) TotalRO(vol) PeakRO Coeff

export interface ScatterValues {
  /** Link name -> maximum |flow|. */
  flows: Map<string, number>;
  /** Node name -> maximum HGL (falls back to maximum depth when HGL column missing). */
  heads: Map<string, number>;
  /** Subcatchment name -> total runoff depth (in/mm). */
  runoff: Map<string, number>;
  /** Node name -> maximum depth (always the Maximum Depth column). */
  nodeDepths: Map<string, number>;
  /** Conduit name -> max/full depth ratio (fraction of the pipe filled). */
  linkDepths: Map<string, number>;
  /** Axis captions. */
  headsLabel: "Maximum HGL" | "Maximum Depth";
}

/** Return the data lines of a named summary section (between its dashed rules). */
function sectionRows(lines: string[], title: RegExp): string[][] {
  let i = lines.findIndex(l => title.test(l));
  if (i < 0) return [];
  // Skip to the dashed line that opens the header block.
  while (i < lines.length && !/^\s*-{10,}/.test(lines[i])) i++;
  if (i >= lines.length) return [];
  i++;
  // Skip header lines until the dashed line that closes the header block.
  while (i < lines.length && !/^\s*-{10,}/.test(lines[i])) i++;
  i++;
  const rows: string[][] = [];
  for (; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t) break;
    if (/^-{10,}/.test(t) || /^\*{3,}/.test(t)) break;
    rows.push(t.split(/\s+/));
  }
  return rows;
}

function num(s: string | undefined): number | undefined {
  if (s === undefined) return undefined;
  const v = parseFloat(s);
  return Number.isFinite(v) ? v : undefined;
}

export function extractScatterValues(report: string): ScatterValues {
  const lines = report.split("\n");
  const flows = new Map<string, number>();
  const heads = new Map<string, number>();
  const runoff = new Map<string, number>();
  const nodeDepths = new Map<string, number>();
  const linkDepths = new Map<string, number>();
  let headsLabel: ScatterValues["headsLabel"] = "Maximum HGL";

  // Link Flow Summary — col 2 is Maximum |Flow| (name, type, flow, ...).
  // Conduit rows end with Max/Full Flow and Max/Full Depth (8 columns);
  // pumps/weirs/etc. have fewer columns and no depth ratio.
  for (const row of sectionRows(lines, /^\s*Link Flow Summary\s*$/)) {
    if (row.length < 3) continue;
    const v = num(row[2]);
    if (v !== undefined) flows.set(row[0], Math.abs(v));
    if (row[1]?.toUpperCase() === "CONDUIT" && row.length >= 8) {
      const d = num(row[7]);
      if (d !== undefined) linkDepths.set(row[0], d);
    }
  }

  // Node Depth Summary — cols: name type avgDepth maxDepth maxHGL days hr:min.
  // Detect whether the HGL column exists by checking the header block.
  const nodeHeaderIdx = lines.findIndex(l => /^\s*Node Depth Summary\s*$/.test(l));
  const hasHgl = nodeHeaderIdx >= 0 &&
    lines.slice(nodeHeaderIdx, nodeHeaderIdx + 8).some(l => /HGL/i.test(l));
  if (!hasHgl) headsLabel = "Maximum Depth";
  for (const row of sectionRows(lines, /^\s*Node Depth Summary\s*$/)) {
    if (row.length < 4) continue;
    const v = num(hasHgl ? row[4] : row[3]);
    if (v !== undefined) heads.set(row[0], v);
    const d = num(row[3]);
    if (d !== undefined) nodeDepths.set(row[0], d);
  }

  // Subcatchment Runoff Summary — total runoff depth is the 3rd column from
  // the end of the numeric block minus peak+coeff... safer: fixed position 7
  // (name + 6 depth columns before it), validated as numeric.
  for (const row of sectionRows(lines, /^\s*Subcatchment Runoff Summary\s*$/)) {
    if (row.length < 9) continue;
    const v = num(row[7]);
    if (v !== undefined) runoff.set(row[0], v);
  }

  return { flows, heads, runoff, nodeDepths, linkDepths, headsLabel };
}
