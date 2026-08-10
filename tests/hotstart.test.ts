import { describe, it, expect } from 'vitest';
import { needsExtran8Hotstart, rewriteHotstartPath } from '../shared/inpOptions';

const INP_WITH_HOTSTART = `[TITLE]
Test
[FILES]
USE HOTSTART "extran8b.hsf"
[OPTIONS]
`;

const INP_SAVE_ONLY = `[FILES]
SAVE HOTSTART "extran8.hsf"
`;

describe('needsExtran8Hotstart', () => {
  it('matches extran8 models that USE HOTSTART', () => {
    expect(needsExtran8Hotstart('extran8b.inp', INP_WITH_HOTSTART)).toBe(true);
  });

  it('strips upload index and Demo_ prefixes', () => {
    expect(needsExtran8Hotstart('3-Demo_extran8b.inp', INP_WITH_HOTSTART)).toBe(true);
    expect(needsExtran8Hotstart('/uploads/job1/0-extran8b.inp', INP_WITH_HOTSTART)).toBe(true);
  });

  it('ignores non-extran8 models and SAVE-only models', () => {
    expect(needsExtran8Hotstart('extran7.inp', INP_WITH_HOTSTART)).toBe(false);
    expect(needsExtran8Hotstart('extran8a.inp', INP_SAVE_ONLY)).toBe(false);
  });
});

describe('rewriteHotstartPath', () => {
  it('replaces the USE HOTSTART target with the new path', () => {
    const out = rewriteHotstartPath(INP_WITH_HOTSTART, '/extran8.hsf');
    expect(out).toContain('USE HOTSTART "/extran8.hsf"');
    expect(out).not.toContain('extran8b.hsf');
  });

  it('leaves SAVE HOTSTART lines alone', () => {
    expect(rewriteHotstartPath(INP_SAVE_ONLY, '/x.hsf')).toBe(INP_SAVE_ONLY);
  });
});
