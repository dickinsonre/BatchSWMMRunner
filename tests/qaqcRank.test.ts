import { describe, it, expect } from 'vitest';
import { rankPeakDifferences, bareElementName, seriesKind } from '../client/src/lib/qaqcReport';

const mk = (title: string, element: string, columns: string[], units: string[], rows: number[][]) => ({
  title, element, columns, units,
  data: rows.map((values, i) => ({ time: `01/01/2002 0${i}:00`, values })),
});

describe('rankPeakDifferences', () => {
  it('ranks shared outputs worst-first by peak % difference', () => {
    const s5 = [
      mk('Link Results Time Series', 'Link 1', ['Flow'], ['CFS'], [[10], [20]]),
      mk('Node Results Time Series', 'Node 9', ['Depth'], ['ft'], [[1], [2]]),
    ];
    const s6 = [
      mk('Link Results Time Series', 'Link 1', ['Flow'], ['CFS'], [[10], [30]]), // 50% off
      mk('Node Results Time Series', 'Node 9', ['Depth'], ['ft'], [[1], [2.1]]), // 5% off
    ];
    const ranked = rankPeakDifferences(s5, s6);
    expect(ranked).toHaveLength(2);
    expect(ranked[0].element).toBe('1'); // names are normalized to the bare element name
    expect(ranked[0].diffPct).toBeCloseTo(50);
    expect(ranked[0].kind).toBe('link');
    expect(ranked[1].element).toBe('9');
    expect(ranked[1].kind).toBe('node');
  });

  it('skips elements or columns missing from one engine', () => {
    const s5 = [mk('Link Results Time Series', 'Link 1', ['Flow'], ['CFS'], [[5]])];
    const s6 = [mk('Link Results Time Series', 'Link 2', ['Flow'], ['CFS'], [[5]])];
    expect(rankPeakDifferences(s5, s6)).toHaveLength(0);
  });

  it('matches SWMM5 prefixed names ("Node 9") against SWMM6 bare names ("9")', () => {
    const s5 = [mk('Time Series Results', 'Node 9', ['Depth'], ['ft'], [[1], [2]])];
    const s6 = [mk('Node Results Time Series', '9', ['Depth'], ['ft'], [[1], [2.2]])];
    const ranked = rankPeakDifferences(s5, s6);
    expect(ranked).toHaveLength(1);
    expect(ranked[0].element).toBe('9');
    expect(ranked[0].kind).toBe('node');
    expect(ranked[0].diffPct).toBeCloseTo(10);
  });

  it('falls back to absolute difference when SWMM5 peak is ~0', () => {
    const s5 = [mk('Node Results Time Series', 'Node 1', ['Depth'], ['ft'], [[0]])];
    const s6 = [mk('Node Results Time Series', 'Node 1', ['Depth'], ['ft'], [[0.5]])];
    const ranked = rankPeakDifferences(s5, s6);
    expect(ranked[0].diffPct).toBeUndefined();
    expect(ranked[0].absDiff).toBeCloseTo(0.5);
  });
});

describe('element name helpers', () => {
  it('strips type prefixes', () => {
    expect(bareElementName('Node 9')).toBe('9');
    expect(bareElementName('Link 23916015-23916007')).toBe('23916015-23916007');
    expect(bareElementName('9')).toBe('9');
  });

  it('classifies series by title or element prefix', () => {
    expect(seriesKind('Link Results Time Series', '1')).toBe('link');
    expect(seriesKind('Time Series Results', 'Node 9')).toBe('node');
    expect(seriesKind('System Time Series Results', 'System')).toBe('system');
  });
});
