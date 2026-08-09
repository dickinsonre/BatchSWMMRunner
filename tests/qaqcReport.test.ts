import { describe, it, expect } from 'vitest';
import { ensureReportAll } from '../client/src/lib/qaqcReport';

describe('ensureReportAll', () => {
  it('adds a [REPORT] section when missing', () => {
    const out = ensureReportAll('[TITLE]\nTest\n\n[OPTIONS]\nFLOW_UNITS CFS\n');
    expect(out).toMatch(/\[REPORT\]/);
    expect(out).toMatch(/NODES ALL/);
    expect(out).toMatch(/LINKS ALL/);
  });

  it('replaces existing NODES/LINKS lines in [REPORT]', () => {
    const inp = '[REPORT]\nINPUT NO\nNODES N1 N2\nLINKS L1\n\n[OPTIONS]\nFLOW_UNITS CFS\n';
    const out = ensureReportAll(inp);
    expect(out).not.toMatch(/NODES N1/);
    expect(out).not.toMatch(/LINKS L1(\s|$)/);
    expect(out).toMatch(/INPUT NO/);
    expect(out.match(/NODES ALL/g)?.length).toBe(1);
    expect(out.match(/LINKS ALL/g)?.length).toBe(1);
    // NODES ALL must still be inside the [REPORT] section (before [OPTIONS])
    expect(out.indexOf('NODES ALL')).toBeLessThan(out.indexOf('[OPTIONS]'));
  });

  it('handles [REPORT] as the last section', () => {
    const out = ensureReportAll('[OPTIONS]\nFLOW_UNITS CFS\n\n[REPORT]\nINPUT NO\n');
    expect(out.trim()).toMatch(/LINKS ALL$/);
  });
});
