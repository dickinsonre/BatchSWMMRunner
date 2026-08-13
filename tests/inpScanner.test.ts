import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { scanInpContent } from '../shared/inpScanner';

const fixture = (name: string) =>
  readFileSync(join(__dirname, 'fixtures', name), 'utf-8');

const BASE = `
[JUNCTIONS]
J1  100  4
J2  98   4

[OUTFALLS]
O1  95  FREE

[CONDUITS]
C1  J1  J2  400  0.013  0  0
C2  J2  O1  400  0.013  0  0
`;

describe('scanInpContent', () => {
  it('marks the valid fixture model as ready', () => {
    const r = scanInpContent(fixture('valid-model.inp'));
    expect(r.errorCount).toBe(0);
    expect(r.status).toBe('ready');
  });

  it('marks a minimal connected network as ready', () => {
    const r = scanInpContent(BASE);
    expect(r.status).toBe('ready');
    expect(r.issues).toEqual([]);
  });

  it('rejects non-INP content', () => {
    const r = scanInpContent('hello world\nno sections here');
    expect(r.status).toBe('invalid');
    expect(r.issues[0].code).toBe('NOT_INP');
  });

  it('detects duplicate node IDs', () => {
    const r = scanInpContent(BASE + '\n[JUNCTIONS]\nJ1  99  4\n');
    expect(r.status).toBe('invalid');
    expect(r.issues.some(i => i.code === 'DUPLICATE_ID' && i.message.includes('"J1"'))).toBe(true);
  });

  it('detects duplicate IDs across node sections (junction vs outfall)', () => {
    const r = scanInpContent(BASE.replace('O1  95  FREE', 'J1  95  FREE'));
    expect(r.issues.some(i => i.code === 'DUPLICATE_ID')).toBe(true);
  });

  it('detects links referencing missing nodes', () => {
    const r = scanInpContent(BASE + '\n[CONDUITS]\nC3  J2  NOPE  100  0.013  0  0\n');
    expect(r.status).toBe('invalid');
    expect(r.issues.some(i => i.code === 'MISSING_NODE' && i.message.includes('"NOPE"'))).toBe(true);
  });

  it('detects zero and negative conduit lengths', () => {
    const zero = scanInpContent(BASE.replace('C1  J1  J2  400', 'C1  J1  J2  0'));
    expect(zero.issues.some(i => i.code === 'BAD_LENGTH')).toBe(true);
    const neg = scanInpContent(BASE.replace('C1  J1  J2  400', 'C1  J1  J2  -50'));
    expect(neg.issues.some(i => i.code === 'BAD_LENGTH')).toBe(true);
    expect(neg.status).toBe('invalid');
  });

  it('flags adverse slopes as warnings', () => {
    // J2 invert above J1: C1 flows uphill
    const r = scanInpContent(BASE.replace('J2  98   4', 'J2  102  4'));
    expect(r.status).toBe('warning');
    expect(r.issues.some(i => i.code === 'ADVERSE_SLOPE' && i.message.includes('"C1"'))).toBe(true);
  });

  it('accounts for offsets when computing slope', () => {
    // J2 above J1 but big inlet offset keeps drop positive
    const adverse = BASE.replace('J2  98   4', 'J2  102  4');
    const fixed = adverse.replace('C1  J1  J2  400  0.013  0  0', 'C1  J1  J2  400  0.013  5  0');
    const r = scanInpContent(fixed);
    expect(r.issues.some(i => i.code === 'ADVERSE_SLOPE')).toBe(false);
  });

  it('detects missing rain gage and outlet references from subcatchments', () => {
    const r = scanInpContent(BASE + '\n[SUBCATCHMENTS]\nS1  GHOST  NOWHERE  5  50  500  0.5  0\n');
    expect(r.issues.some(i => i.code === 'MISSING_GAGE')).toBe(true);
    expect(r.issues.some(i => i.code === 'MISSING_OUTLET')).toBe(true);
  });

  it('detects rain gage referencing undefined time series', () => {
    const r = scanInpContent(BASE + '\n[RAINGAGES]\nRG1  INTENSITY  1:00  1.0  TIMESERIES  TSX\n');
    expect(r.issues.some(i => i.code === 'MISSING_TIMESERIES')).toBe(true);
  });

  it('warns about external file dependencies', () => {
    const gageFile = scanInpContent(BASE + '\n[RAINGAGES]\nRG1  INTENSITY  1:00  1.0  FILE  "rain.dat"\n');
    expect(gageFile.status).toBe('warning');
    expect(gageFile.issues.some(i => i.code === 'EXTERNAL_FILE')).toBe(true);

    const tsFile = scanInpContent(BASE + '\n[TIMESERIES]\nTS1  FILE  "flows.dat"\n');
    expect(tsFile.issues.some(i => i.code === 'EXTERNAL_FILE')).toBe(true);

    const useFile = scanInpContent(BASE + '\n[FILES]\nUSE  RAINFALL  "rain.rff"\n');
    expect(useFile.issues.some(i => i.code === 'EXTERNAL_FILE')).toBe(true);
  });

  it('detects inflow/DWF references to missing nodes, series, and patterns', () => {
    const r = scanInpContent(
      BASE +
      '\n[INFLOWS]\nGHOST  FLOW  TSX\n' +
      '\n[DWF]\nJ1  FLOW  1.0  PAT9\n',
    );
    expect(r.issues.filter(i => i.code === 'MISSING_NODE').length).toBe(1);
    expect(r.issues.some(i => i.code === 'MISSING_TIMESERIES')).toBe(true);
    expect(r.issues.some(i => i.code === 'MISSING_PATTERN')).toBe(true);
  });

  it('detects missing pump and storage curves', () => {
    const r = scanInpContent(
      BASE +
      '\n[PUMPS]\nP1  J1  J2  PCURVE  ON\n' +
      '\n[STORAGE]\nST1  90  10  0  TABULAR  SCURVE\n' +
      '\n[CONDUITS]\nC9  ST1  O1  100  0.013  0  0\n',
    );
    expect(r.issues.filter(i => i.code === 'MISSING_CURVE').length).toBe(2);
  });

  it('warns about disconnected nodes', () => {
    const r = scanInpContent(BASE + '\n[JUNCTIONS]\nLONER  100  4\n');
    expect(r.status).toBe('warning');
    expect(r.issues.some(i => i.code === 'DISCONNECTED_NODE' && i.message.includes('"LONER"'))).toBe(true);
  });

  it('does not flag subcatchment outlet nodes as disconnected', () => {
    const model = `
[RAINGAGES]
RG1  INTENSITY  1:00  1.0  TIMESERIES  TS1
[SUBCATCHMENTS]
S1  RG1  J1  5  50  500  0.5  0
[JUNCTIONS]
J1  100  4
[OUTFALLS]
O1  95  FREE
[CONDUITS]
C1  J1  O1  400  0.013  0  0
[TIMESERIES]
TS1  0:00  0.5
`;
    const r = scanInpContent(model);
    expect(r.issues.some(i => i.code === 'DISCONNECTED_NODE')).toBe(false);
  });

  it('flags an empty model', () => {
    const r = scanInpContent('[TITLE]\nempty\n[OPTIONS]\nFLOW_UNITS CFS\n');
    expect(r.status).toBe('invalid');
    expect(r.issues.some(i => i.code === 'EMPTY_MODEL')).toBe(true);
  });

  it('ignores comment lines', () => {
    const r = scanInpContent(BASE + '\n[CONDUITS]\n; C_BAD  J1  NOPE  0  0.013  0  0\n');
    expect(r.status).toBe('ready');
  });

  it('handles other fixture models without crashing', () => {
    for (const name of ['routing-only.inp', 'long-model.inp', 'invalid-section.inp']) {
      const r = scanInpContent(fixture(name));
      expect(['ready', 'warning', 'invalid']).toContain(r.status);
    }
  });
});
