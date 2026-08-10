import { describe, it, expect } from 'vitest';
import { buildWorstOverlays } from '../client/src/lib/seriesOverlays';
import { extractScatterValues } from '../client/src/lib/summaryScatter';

// Minimal synthetic report with summary tables plus node and link time series,
// mimicking the SWMM5 layout (element headers include the "Link"/"Node" prefix).
function makeReport(flowPeak: number, nodeDepth: number, flowAt1h: number, depthAt1h: number): string {
  return `
  Node Depth Summary
  ******************
  
  ---------------------------------------------------------------------------------
                                 Average  Maximum  Maximum  Time of Max    Reported
                                   Depth    Depth      HGL   Occurrence   Max Depth
  Node                 Type         Feet     Feet     Feet  days hr:min        Feet
  ---------------------------------------------------------------------------------
  N1                   JUNCTION     0.10     ${nodeDepth.toFixed(2)}  1000.50     0  04:01        ${nodeDepth.toFixed(2)}
  
  
  Link Flow Summary
  ********************
  
  -----------------------------------------------------------------------------
                                 Maximum  Time of Max   Maximum    Max/    Max/
                                  |Flow|   Occurrence   |Veloc|    Full    Full
  Link                 Type          CFS  days hr:min    ft/sec    Flow   Depth
  -----------------------------------------------------------------------------
  L1                   CONDUIT      ${flowPeak.toFixed(2)}     0  04:01      7.60    0.30    ${(depthAt1h / 10).toFixed(2)}
  
  
  ***********************
  Node Results Time Series
  ***********************
  
  <<< Node N1 >>>
                           Inflow  Flooding    Depth     Head
  Date        Time            CFS       CFS     feet     feet
  ----------------------------------------------------------
  01/01/2020  00:00:00       0.00      0.00     0.00  1000.00
  01/01/2020  01:00:00       1.00      0.00     ${depthAt1h.toFixed(2)}  1000.50
  
  ***********************
  Link Results Time Series
  ***********************
  
  <<< Link L1 >>>
                            Flow  Velocity    Depth  Capacity
  Date        Time           CFS    ft/sec     feet
  ----------------------------------------------------------
  01/01/2020  00:00:00      0.00      0.00     0.00      1.00
  01/01/2020  01:00:00      ${flowAt1h.toFixed(2)}      2.00     ${depthAt1h.toFixed(2)}      1.00
`;
}

describe('buildWorstOverlays', () => {
  const repA = makeReport(4.5, 0.6, 4.0, 0.5);
  const repB = makeReport(5.5, 0.9, 5.0, 0.8);
  const valsA = extractScatterValues(repA);
  const valsB = extractScatterValues(repB);
  const overlays = buildWorstOverlays(repA, repB, valsA, valsB);

  it('produces all three overlays (flow, node depth, link depth)', () => {
    expect(overlays.map(o => o.id)).toEqual(['worst-flow', 'worst-node-depth', 'worst-link-depth']);
  });

  it('merges rows for the worst link flow', () => {
    const flow = overlays.find(o => o.id === 'worst-flow')!;
    expect(flow.name).toBe('L1');
    expect(flow.rows).not.toBeNull();
    const at1h = flow.rows!.find(r => Math.abs(r.h - 1) < 1e-6)!;
    expect(at1h.a).toBeCloseTo(4.0, 2);
    expect(at1h.b).toBeCloseTo(5.0, 2);
  });

  it('picks the depth column for node and link depth overlays', () => {
    const node = overlays.find(o => o.id === 'worst-node-depth')!;
    expect(node.name).toBe('N1');
    const nAt1h = node.rows!.find(r => Math.abs(r.h - 1) < 1e-6)!;
    expect(nAt1h.a).toBeCloseTo(0.5, 2);
    expect(nAt1h.b).toBeCloseTo(0.8, 2);

    const link = overlays.find(o => o.id === 'worst-link-depth')!;
    expect(link.name).toBe('L1');
    const lAt1h = link.rows!.find(r => Math.abs(r.h - 1) < 1e-6)!;
    expect(lAt1h.a).toBeCloseTo(0.5, 2);
    expect(lAt1h.b).toBeCloseTo(0.8, 2);
  });

  it('reports a reason instead of rows when series are absent', () => {
    // Reports with summaries but no time series sections.
    const bare = repA.split('***********************')[0];
    const overlaysBare = buildWorstOverlays(bare, bare, extractScatterValues(bare), extractScatterValues(bare));
    for (const o of overlaysBare) {
      expect(o.rows).toBeNull();
      expect(o.reason).toBe('none');
    }
  });
});
