import { describe, it, expect } from 'vitest';
import { computeWasmConcurrency } from '../client/src/lib/swmmWasmEngine';

const MB = 1024 * 1024;

describe('computeWasmConcurrency', () => {
  it('uses min(cores-1, files, 4)', () => {
    expect(computeWasmConcurrency(10, 1 * MB, 8)).toBe(4);
    expect(computeWasmConcurrency(2, 1 * MB, 8)).toBe(2);
    expect(computeWasmConcurrency(10, 1 * MB, 3)).toBe(2);
  });

  it('never drops below 1', () => {
    expect(computeWasmConcurrency(5, 1 * MB, 1)).toBe(1);
    expect(computeWasmConcurrency(1, 0, 8)).toBe(1);
  });

  it('falls back to sequential for very large files', () => {
    expect(computeWasmConcurrency(10, 50 * MB, 8)).toBe(1);
    expect(computeWasmConcurrency(10, 10 * MB, 8)).toBe(4); // exactly at threshold stays parallel
  });
});
