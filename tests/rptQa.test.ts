import { describe, it, expect } from 'vitest';
import { classifyRun, healthScore, findOutliers, buildManifestCsv } from '../client/src/lib/rptQa';

const base = { status: 'success' as const, warningCount: 0, errorCount: 0 };

describe('classifyRun', () => {
  it('PASS for a clean success', () => {
    expect(classifyRun({ ...base, runoffCE: 0.1, routingCE: 0.05, nodesFlooded: 0 })).toBe('PASS');
  });
  it('PASS WITH WARNINGS for mild CE, warnings, or flooding', () => {
    expect(classifyRun({ ...base, routingCE: 1.5 })).toBe('PASS WITH WARNINGS');
    expect(classifyRun({ ...base, routingCE: 0.1, warningCount: 2 })).toBe('PASS WITH WARNINGS');
    expect(classifyRun({ ...base, routingCE: 0.1, nodesFlooded: 3 })).toBe('PASS WITH WARNINGS');
  });
  it('INCOMPLETE when a success has no parsed continuity data', () => {
    expect(classifyRun({ ...base, warningCount: 2 })).toBe('INCOMPLETE');
  });
  it('REVIEW for large continuity error', () => {
    expect(classifyRun({ ...base, routingCE: 4.9 })).toBe('REVIEW');
    expect(classifyRun({ ...base, runoffCE: -8 })).toBe('REVIEW');
  });
  it('FAIL for non-success status or report errors', () => {
    expect(classifyRun({ ...base, status: 'failed' })).toBe('FAIL');
    expect(classifyRun({ ...base, errorCount: 1 })).toBe('FAIL');
  });
  it('respects custom thresholds', () => {
    expect(classifyRun({ ...base, routingCE: 1.5 }, { ceWarn: 2, ceReview: 5 })).toBe('PASS');
  });
});

describe('healthScore', () => {
  it('scores a clean run 100', () => {
    const h = healthScore({ ...base, runoffCE: 0.01, routingCE: 0.02, nodesFlooded: 0 });
    expect(h.score).toBe(100);
    expect(h.label).toBe('Excellent');
  });
  it('penalizes continuity, flooding, and warnings', () => {
    const h = healthScore({ ...base, routingCE: 7.8, nodesFlooded: 24, warningCount: 6 });
    expect(h.parts.continuity).toBeLessThan(25);
    expect(h.parts.flooding).toBe(0);
    expect(h.parts.warnings).toBe(13);
    expect(h.score).toBeLessThan(75);
  });
  it('failed runs score near zero', () => {
    expect(healthScore({ ...base, status: 'failed' }).score).toBe(0);
  });
});

describe('findOutliers', () => {
  it('flags the one run far from the rest', () => {
    const rows = [0.01, 0.02, 0.015, 0.02, 0.01, 8.73].map((v, i) => ({ id: `r${i}`, value: v }));
    const out = findOutliers(rows);
    expect(out.has('r5')).toBe(true);
    expect(out.size).toBe(1);
  });
  it('needs at least 4 values and flags nothing on uniform data', () => {
    expect(findOutliers([{ id: 'a', value: 1 }, { id: 'b', value: 100 }]).size).toBe(0);
    expect(findOutliers([1, 1, 1, 1, 1].map((v, i) => ({ id: `r${i}`, value: v }))).size).toBe(0);
  });
});

describe('buildManifestCsv', () => {
  it('emits a header row and one row per result with quoting', () => {
    const csv = buildManifestCsv([
      {
        fileName: 'a "quoted".inp', status: 'success', engine: 'executable', engineVersion: '5.2.4',
        startedAt: '2026-08-11T00:00:00Z', completedAt: '2026-08-11T00:00:05Z', processingTime: 5,
        runoffCE: 0.1, routingCE: 0.2, nodesFlooded: 0, warningCount: 1, errorCount: 0,
        qaClass: 'PASS WITH WARNINGS', health: 98, outputs: ['a.rpt', 'a.inp'],
      },
    ], '2026-08-11T01:00:00Z');
    const lines = csv.split('\n');
    expect(lines[0]).toContain('generated');
    expect(lines[1]).toContain('"Engine Version"');
    expect(lines[2]).toContain('"a ""quoted"".inp"');
    expect(lines[2]).toContain('"5.2.4"');
    expect(lines[2]).toContain('"a.rpt; a.inp"');
  });
});

import { buildResultsZip } from '../client/src/lib/zipExport';

describe('zip manifest', () => {
  it('includes batch_manifest.csv when there are results', async () => {
    const { zip } = await buildResultsZip([
      {
        id: '1', fileName: 'm.inp', filePath: 'm.inp', status: 'success',
        reportContent: 'rpt', inpContent: 'inp', processingTime: 2,
        parsedMetrics: { runoffContinuityError: 0.1, routingContinuityError: 0.2, nodesFlooded: 0 },
        provenance: { requestedEngine: 'executable', engineVersion: '5.2.4' },
      } as any,
    ]);
    const csv = await zip.file('batch_manifest.csv')!.async('string');
    expect(csv).toContain('"m.inp"');
    expect(csv).toContain('"5.2.4"');
    expect(csv).toContain('"PASS"');
  });
});

describe('review fixes', () => {
  it('success with no continuity data is INCOMPLETE, not PASS', () => {
    expect(classifyRun({ ...base })).toBe('INCOMPLETE');
    const h = healthScore({ ...base });
    expect(h.score).toBeUndefined();
    expect(h.label).toBe('No data');
  });
  it('normalizes inverted thresholds (warn > review)', () => {
    expect(classifyRun({ ...base, routingCE: 4 }, { ceWarn: 5, ceReview: 1 })).toBe('PASS');
    expect(classifyRun({ ...base, routingCE: 6 }, { ceWarn: 5, ceReview: 1 })).toBe('REVIEW');
  });
  it('zero-MAD batches only flag huge absolute deviations', () => {
    // All zeros plus a tiny value: no outlier.
    const tiny = [0, 0, 0, 0, 0.01].map((v, i) => ({ id: `r${i}`, value: v }));
    expect(findOutliers(tiny).size).toBe(0);
    // All zeros plus a huge value: outlier.
    const huge = [0, 0, 0, 0, 8.7].map((v, i) => ({ id: `r${i}`, value: v }));
    expect(findOutliers(huge).has('r4')).toBe(true);
  });
  it('neutralizes spreadsheet formulas in manifest cells', () => {
    const csv = buildManifestCsv([
      {
        fileName: '=cmd|calc.inp', status: 'success', warningCount: 0, errorCount: 0,
        qaClass: 'PASS', health: 100, outputs: [],
      },
    ], '2026-08-11T01:00:00Z');
    expect(csv).toContain(`"'=cmd|calc.inp"`);
  });
});
