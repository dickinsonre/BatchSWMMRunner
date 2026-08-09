import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { extractScatterValues } from '../client/src/lib/summaryScatter';
import { FIXTURES } from './helpers';

const rpt = fs.readFileSync(path.join(FIXTURES, 'example1-summary.rpt'), 'utf-8');

describe('extractScatterValues', () => {
  const vals = extractScatterValues(rpt);

  it('reads maximum |flow| for each link from Link Flow Summary', () => {
    // From the fixture: link 1 -> 4.65 CFS
    expect(vals.flows.get('1')).toBeCloseTo(4.65, 2);
    expect(vals.flows.size).toBeGreaterThan(5);
  });

  it('reads maximum HGL for each node from Node Depth Summary', () => {
    expect(vals.headsLabel).toBe('Maximum HGL');
    // From the fixture: node 9 -> 1000.57 ft, node 10 -> 998.00 ft
    expect(vals.heads.get('9')).toBeCloseTo(1000.57, 2);
    expect(vals.heads.get('10')).toBeCloseTo(998.0, 2);
  });

  it('reads total runoff depth for each subcatchment', () => {
    // From the fixture: subcatchment 1 -> 1.48 in (Total Runoff depth column)
    expect(vals.runoff.get('1')).toBeCloseTo(1.48, 2);
    expect(vals.runoff.size).toBeGreaterThan(3);
  });

  it('returns empty maps when sections are absent', () => {
    const empty = extractScatterValues('no tables here');
    expect(empty.flows.size).toBe(0);
    expect(empty.heads.size).toBe(0);
    expect(empty.runoff.size).toBe(0);
  });
});
